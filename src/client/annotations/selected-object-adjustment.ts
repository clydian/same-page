import type { AnnotationPayload } from "../../shared/annotations";
import type { AnnotationEditor } from "./annotation-editor";
import type { ObjectMovement } from "./object-movement";

type Input = "properties" | "keyboard";
type Target = { id: string; layerId: string; payload: AnnotationPayload };
type TextTarget = Target & { payload: Extract<AnnotationPayload, { kind: "text" }> };
interface Snapshot { selected: Target | null; preview: Target | null; }

// Properties and held keys share one temporary intent. Released intent, failed
// writes and undo stay with ObjectMovement and AnnotationEditor.
export class SelectedObjectAdjustment {
  private selectedId: string | null = null;
  private pending: { source: Input; target: Target; original: AnnotationPayload } | null = null;
  private active = false;
  private revision = 0;
  private listeners = new Set<() => void>();
  private snapshot: Snapshot = { selected: null, preview: null };

  constructor(
    private readonly editor: AnnotationEditor | null,
    private readonly movement: ObjectMovement,
    private readonly scope: { pageNumber: number; layerId: string | null; enabled: boolean },
  ) {}

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  connect() {
    this.active = true;
    const unsubscribe = this.movement.subscribe(() => this.publish());
    const finish = this.editor?.registerFinishCommit(() => this.commit());
    const guard = this.editor?.registerNavigationGuard(() => this.pending === null);
    this.publish();
    return () => {
      this.active = false;
      this.revision++;
      this.pending = null;
      this.selectedId = null;
      unsubscribe(); finish?.(); guard?.();
      this.publish();
    };
  }

  select(id: string | null) {
    if (!this.active || !this.scope.enabled || id === this.selectedId) return;
    void this.commit();
    this.revision++;
    this.selectedId = id;
    this.publish();
  }

  change(source: Input, update: (payload: AnnotationPayload) => AnnotationPayload) {
    if (!this.active || !this.scope.enabled || !this.editor || ["failed", "finishing"].includes(this.editor.getSnapshot())) return;
    if (this.pending && this.pending.source !== source) void this.commit();
    const target = this.selected();
    if (!target) return;
    const payload = update(target.payload);
    if (JSON.stringify(payload) === JSON.stringify(target.payload)) return;
    this.revision++;
    this.pending = { source, target: { ...target, payload }, original: this.pending?.original ?? target.payload };
    this.publish();
  }

  // Source-specific releases cannot settle an adjustment started by another
  // input path (for example a late keyup after activating a property button).
  commit(source?: Input): Promise<boolean> {
    const pending = this.pending;
    if (!this.active || !pending || (source && pending.source !== source)) return Promise.resolve(true);
    this.pending = null;
    const result = JSON.stringify(pending.target.payload) === JSON.stringify(pending.original)
      ? Promise.resolve(true) : this.movement.persist(pending.target);
    // persist installs the durable projection synchronously, before preview ends.
    this.publish();
    return result;
  }

  remove() {
    const target = this.selected();
    if (!this.active || !target) return;
    // Deletion supersedes the unfinished adjustment, not an already released edit.
    this.pending = null;
    this.selectedId = null;
    this.revision++;
    void this.movement.persist({ ...target, payload: null, deleted: true });
    this.publish();
  }

  editText(open: (target: TextTarget) => void) {
    const target = this.selected();
    if (!target || target.payload.kind !== "text") return;
    const revision = this.revision;
    const proceed = () => {
      if (!this.active || revision !== this.revision) return;
      const latest = this.selected();
      if (!latest || latest.payload.kind !== "text") return;
      this.select(null);
      open({ ...latest, payload: latest.payload });
    };
    // Preserve user-gesture focus when there is no adjustment awaiting release.
    if (!this.pending) proceed();
    else void this.commit().then(saved => { if (saved) proceed(); });
  }

  private selected(): Target | null {
    if (!this.active || !this.scope.enabled) return null;
    const note = this.movement.getSnapshot().annotations.find(note => note.id === this.selectedId
      && note.layerId === this.scope.layerId && !note.deleted && note.payload?.pageNumber === this.scope.pageNumber);
    if (!note?.payload) return null;
    return this.pending?.target ?? { id: note.id, layerId: note.layerId, payload: note.payload };
  }

  private publish() {
    this.snapshot = { selected: this.selected(), preview: this.pending?.target ?? null };
    for (const listener of this.listeners) listener();
  }
}
