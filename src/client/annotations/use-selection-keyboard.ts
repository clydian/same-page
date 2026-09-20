import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import type { AnnotationPayload } from "../../shared/annotations";
import type { AnnotationEditor } from "./annotation-editor";
import type { ObjectMovement } from "./object-movement";

type Target = { id: string; layerId: string; payload: AnnotationPayload };
export function useSelectionKeyboard(options: {
  editor: AnnotationEditor | null; movement: ObjectMovement; root: RefObject<HTMLDivElement | null>;
  enabled: boolean; selecting: boolean; pageNumber: number; layerId: string | null; selectedId: string | null;
  busy(): boolean; preview(payload: AnnotationPayload | null): void; deselect(): void; editText(): void;
}) {
  const { editor, movement, root, enabled, selecting, pageNumber, layerId } = options;
  const current = useRef(options);
  const finishSelection = useRef<(() => Promise<boolean>) | null>(null);
  useLayoutEffect(() => {
    const previous = current.current;
    const sameScope = previous.editor === options.editor && previous.movement === options.movement
      && previous.enabled === options.enabled && previous.selecting === options.selecting
      && previous.pageNumber === options.pageNumber && previous.layerId === options.layerId;
    if (sameScope && previous.selectedId !== options.selectedId) void finishSelection.current?.();
    current.current = options;
  });
  useEffect(() => {
    if (!enabled || !editor) return;
    let pending: Target | null = null;
    const keys = new Set<string>();
    const commit = () => {
      const target = pending;
      pending = null; keys.clear();
      const result = target ? movement.persist(target) : Promise.resolve(true);
      if (target) current.current.preview(null);
      return result;
    };
    const down = (event: KeyboardEvent) => {
      const state = current.current;
      const element = event.target instanceof Element ? event.target : null;
      if (event.defaultPrevented || event.isComposing || state.busy() || editor.getSnapshot() === "failed" || editor.getSnapshot() === "finishing") return;
      if (element?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="slider"], [role="dialog"]')) return;
      const command = event.metaKey || event.ctrlKey;
      const propertyButton = element?.closest(".annotation-object-properties button");
      if (element && element !== document.body && !root.current?.contains(element)
        && !propertyButton && !(command && element.closest(".annotation-controls"))) return;
      // Enter/Space on a property button must activate that button natively.
      if (propertyButton && (event.key === "Enter" || event.key === " ")) return;
      if (command && !event.altKey && (event.key.toLowerCase() === "z" || event.key.toLowerCase() === "y")) {
        if (!state.layerId) return;
        event.preventDefault();
        if (event.repeat) return;
        void commit();
        void (event.shiftKey || event.key.toLowerCase() === "y" ? editor.redo(state.layerId) : editor.undo(state.layerId));
        return;
      }
      if (!state.selecting || command || event.altKey || !state.selectedId) return;
      const note = movement.getSnapshot().annotations.find(note => note.id === state.selectedId && note.layerId === state.layerId && !note.deleted && note.payload?.pageNumber === state.pageNumber);
      if (!note?.payload) return;
      if (event.key.startsWith("Arrow") && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
        const bounds = root.current?.getBoundingClientRect();
        if (!bounds?.width || !bounds.height) return;
        event.preventDefault();
        keys.add(event.key);
        if (pending && (pending.id !== note.id || pending.layerId !== note.layerId)) void commit();
        const payload = pending?.payload ?? note.payload;
        const step = event.shiftKey ? 10 : 1;
        const next = translate(payload, (event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0) / bounds.width, (event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0) / bounds.height);
        if (JSON.stringify(next) === JSON.stringify(payload)) return;
        pending = { id: note.id, layerId: note.layerId, payload: next };
        state.preview(next);
      } else if (["Escape", "Enter", "Delete", "Backspace"].includes(event.key)) {
        event.preventDefault();
        if (event.repeat) return;
        void commit();
        if (event.key === "Escape") state.deselect();
        else if (event.key === "Enter" && note.payload.kind === "text") state.editText();
        else if (event.key === "Delete" || event.key === "Backspace") {
          void movement.persist({ id: note.id, layerId: note.layerId, payload: null, deleted: true });
          state.deselect();
        }
      }
    };
    const up = (event: KeyboardEvent) => { keys.delete(event.key); if (!keys.size) void commit(); };
    const settle = () => { void commit(); };
    finishSelection.current = commit;
    const unregister = editor.registerFinishCommit(commit);
    const guard = editor.registerNavigationGuard(() => pending === null);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", settle);
    document.addEventListener("pointerdown", settle, true);
    return () => {
      if (finishSelection.current === commit) finishSelection.current = null;
      unregister(); guard();
      window.removeEventListener("keydown", down); window.removeEventListener("keyup", up);
      window.removeEventListener("blur", settle); document.removeEventListener("pointerdown", settle, true);
      // Scope/permission changes cancel the unfinished preview, never write into a new scope.
      if (pending) current.current.preview(null);
    };
  // Scope changes cancel; selection changes settle through finishSelection.
  }, [editor, movement, enabled, selecting, pageNumber, layerId, root]);
}

function translate(payload: AnnotationPayload, dx: number, dy: number): AnnotationPayload {
  const xs = payload.kind === "ink" ? payload.points.map(point => point.x) : [payload.x, payload.x + (payload.kind === "shape" ? payload.width : 0)];
  const ys = payload.kind === "ink" ? payload.points.map(point => point.y) : [payload.y, payload.y + (payload.kind === "shape" ? payload.height : 0)];
  dx = Math.max(-xs.reduce((minimum, value) => Math.min(minimum, value), Infinity), Math.min(1 - xs.reduce((maximum, value) => Math.max(maximum, value), -Infinity), dx));
  dy = Math.max(-ys.reduce((minimum, value) => Math.min(minimum, value), Infinity), Math.min(1 - ys.reduce((maximum, value) => Math.max(maximum, value), -Infinity), dy));
  return payload.kind === "ink" ? { ...payload, points: payload.points.map(point => ({ ...point, x: point.x + dx, y: point.y + dy })) } : { ...payload, x: payload.x + dx, y: payload.y + dy };
}
