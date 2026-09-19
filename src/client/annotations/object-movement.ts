import { MAX_TEXT_FONT_SCALE, MIN_TEXT_FONT_SCALE, type AnnotationPayload } from "../../shared/annotations";
import type { LocalAnnotationRecord } from "../platform/local-database";
import type { AnnotationEditor } from "./annotation-editor";

export type MovablePayload = Extract<AnnotationPayload, { kind: "text" | "shape" }>;
type PointerSample = { pointerId: number; clientX: number; clientY: number };
type Bounds = { width: number; height: number };
type DeleteBounds = Bounds & { left: number; top: number };
type ObjectTarget = { id: string; layerId: string; payload: MovablePayload };
const OBJECT_DRAG_THRESHOLD_PX = 6;

interface ObjectTransformState {
  id: string;
  layerId: string;
  payload: MovablePayload;
  preview: MovablePayload;
  pointers: Map<number, { startX: number; startY: number; x: number; y: number }>;
  pinch: {
    distance: number;
    centerX: number;
    centerY: number;
    payload: MovablePayload;
  } | null;
  moved: boolean;
}

interface MovementSnapshot {
  annotations: LocalAnnotationRecord[];
  preview: { id: string; payload: MovablePayload } | null;
  transforming: boolean;
  deleteActive: boolean;
}

// Owns pointer intent and its visual handoff to durable local data. The editor
// remains the only writer and history owner; no DOM or React state lives here.
export class ObjectMovement {
  private active: ObjectTransformState | null = null;
  private released = new Map<string, { payload: MovablePayload; revision: number }>();
  private annotations: LocalAnnotationRecord[] = [];
  private deleteActive = false;
  private listeners = new Set<() => void>();
  private unsubscribeEditor: (() => void) | undefined;
  private snapshot: MovementSnapshot = { annotations: [], preview: null, transforming: false, deleteActive: false };

  constructor(private readonly editor: AnnotationEditor | null) {}
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    this.unsubscribeEditor ??= this.editor?.subscribe(() => this.publish());
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) {
        this.unsubscribeEditor?.();
        this.unsubscribeEditor = undefined;
      }
    };
  };
  get engaged() { return this.active !== null; }
  owns(pointerId: number) { return this.active?.pointers.has(pointerId) ?? false; }

  // Called after a local query update. A query may skip a whole drag
  // position, so the editor's newer committed intent takes precedence.
  reconcile(annotations: LocalAnnotationRecord[]) {
    this.annotations = annotations;
    this.publish();
  }

  begin(sample: PointerSample, target?: ObjectTarget) {
    if (!this.active) {
      if (!target) return false;
      this.active = { ...target, preview: target.payload, pointers: new Map(), pinch: null, moved: false };
    }
    const transform = this.active;
    transform.pointers.set(sample.pointerId, { startX: sample.clientX, startY: sample.clientY, x: sample.clientX, y: sample.clientY });
    if (transform.pointers.size === 2) {
      const [first, second] = [...transform.pointers.values()];
      transform.pinch = {
        distance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
        centerX: (first.x + second.x) / 2,
        centerY: (first.y + second.y) / 2,
        payload: transform.preview,
      };
    }
    return true;
  }

  move(sample: PointerSample, bounds: Bounds, deleteBounds?: DeleteBounds) {
    const transform = this.active;
    const pointer = transform?.pointers.get(sample.pointerId);
    if (!transform || !pointer || bounds.width <= 0 || bounds.height <= 0) return;
    pointer.x = sample.clientX;
    pointer.y = sample.clientY;

    let next: MovablePayload;
    const entries = [...transform.pointers.values()];
    if (entries.length >= 2 && transform.pinch) {
      const [first, second] = entries;
      const centerX = (first.x + second.x) / 2;
      const centerY = (first.y + second.y) / 2;
      const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
      const base = transform.pinch.payload;
      const scale = distance / transform.pinch.distance;
      next = {
        ...base,
        x: transform.pinch.payload.x + (centerX - transform.pinch.centerX) / bounds.width,
        y: transform.pinch.payload.y + (centerY - transform.pinch.centerY) / bounds.height,
        ...(base.kind === "text" ? {
          fontScale: clampRange(base.fontScale * scale, MIN_TEXT_FONT_SCALE, MAX_TEXT_FONT_SCALE),
        } : {
          width: Math.min(1, base.width * scale),
          height: Math.min(1, base.height * scale),
        }),
      };
      transform.moved = true;
    } else {
      const distance = Math.hypot(pointer.x - pointer.startX, pointer.y - pointer.startY);
      if (!transform.moved && distance <= OBJECT_DRAG_THRESHOLD_PX) return;
      transform.moved = true;
      next = {
        ...transform.preview,
        x: transform.preview.x + (pointer.x - pointer.startX) / bounds.width,
        y: transform.preview.y + (pointer.y - pointer.startY) / bounds.height,
      };
      pointer.startX = pointer.x;
      pointer.startY = pointer.y;
    }

    const clamped = next.kind === "text"
      ? { ...next, x: clamp(next.x), y: clamp(next.y) }
      : { ...next, x: clampRange(next.x, 0, 1 - next.width), y: clampRange(next.y, 0, 1 - next.height) };
    transform.preview = clamped;
    const centerX = entries.reduce((total, entry) => total + entry.x, 0) / entries.length;
    const centerY = entries.reduce((total, entry) => total + entry.y, 0) / entries.length;
    this.deleteActive = deleteBounds
      ? Math.hypot(centerX - (deleteBounds.left + deleteBounds.width / 2), centerY - (deleteBounds.top + deleteBounds.height / 2)) <= Math.min(deleteBounds.width, deleteBounds.height) / 2
      : false;
    this.publish();
  }

  // Only an unmoved final release is returned to the UI for selection/text.
  release(pointerId: number): ObjectTarget | null {
    const transform = this.active;
    if (!transform || !this.owns(pointerId)) return null;
    transform.pointers.delete(pointerId);
    if (transform.pointers.size) {
      const [remaining] = transform.pointers.values();
      remaining.startX = remaining.x;
      remaining.startY = remaining.y;
      transform.pinch = null;
      return null;
    }
    this.active = null;
    const shouldDelete = this.deleteActive;
    this.deleteActive = false;
    if (transform.moved) {
      const revision = this.editor?.getEditRevision() ?? 0;
      if (!shouldDelete) this.released.set(transform.id, { payload: transform.preview, revision });
      void this.editor?.persist({ id: transform.id, layerId: transform.layerId, payload: shouldDelete ? null : transform.preview, deleted: shouldDelete });
    }
    this.publish();
    return transform.moved ? null : { id: transform.id, layerId: transform.layerId, payload: transform.payload };
  }

  cancel() {
    this.active = null;
    this.deleteActive = false;
    this.publish();
  }

  discard(id: string) {
    this.released.delete(id);
    this.publish();
  }

  private publish() {
    const projected = new Map<string, AnnotationPayload | null>();
    for (const [id, released] of this.released) {
      const committed = this.editor?.getCommittedObject(id);
      const payload = committed && committed.revision > released.revision ? committed.input.payload : released.payload;
      const record = this.annotations.find(annotation => annotation.id === id);
      const acknowledged = payload === null ? !record || record.deleted : JSON.stringify(record?.payload) === JSON.stringify(payload);
      if (acknowledged) this.released.delete(id);
      else projected.set(id, payload);
    }
    this.snapshot = {
      annotations: this.annotations.map(annotation => projected.has(annotation.id) ? { ...annotation, payload: projected.get(annotation.id) ?? null } : annotation),
      preview: this.active?.moved ? { id: this.active.id, payload: this.active.preview } : null,
      transforming: this.active?.moved ?? false,
      deleteActive: this.deleteActive,
    };
    for (const listener of this.listeners) listener();
  }
}

function clamp(value: number) { return clampRange(value, 0, 1); }
function clampRange(value: number, minimum: number, maximum: number) { return Math.min(maximum, Math.max(minimum, value)); }
