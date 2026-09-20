import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import type { AnnotationPayload } from "../../shared/annotations";
import type { AnnotationEditor } from "./annotation-editor";
import type { SelectedObjectAdjustment } from "./selected-object-adjustment";

export function useSelectionKeyboard(options: {
  editor: AnnotationEditor | null; adjustment: SelectedObjectAdjustment; root: RefObject<HTMLDivElement | null>;
  enabled: boolean; layerId: string | null; busy(): boolean; editText(): void;
}) {
  const { editor, adjustment, root, enabled, layerId } = options;
  const current = useRef(options);
  useLayoutEffect(() => { current.current = options; });
  useEffect(() => {
    if (!enabled || !editor) return;
    const keys = new Set<string>();
    const commit = () => { keys.clear(); return adjustment.commit("keyboard"); };
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
        void adjustment.commit();
        void (event.shiftKey || event.key.toLowerCase() === "y" ? editor.redo(state.layerId) : editor.undo(state.layerId));
        return;
      }
      if (command || event.altKey) return;
      const note = adjustment.getSnapshot().selected;
      if (!note?.payload) return;
      if (event.key.startsWith("Arrow") && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
        const bounds = root.current?.getBoundingClientRect();
        if (!bounds?.width || !bounds.height) return;
        event.preventDefault();
        keys.add(event.key);
        const step = event.shiftKey ? 10 : 1;
        adjustment.change("keyboard", payload => translate(payload,
          (event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0) / bounds.width,
          (event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0) / bounds.height));
      } else if (["Escape", "Enter", "Delete", "Backspace"].includes(event.key)) {
        event.preventDefault();
        if (event.repeat) return;
        if (event.key === "Escape") adjustment.select(null);
        else if (event.key === "Enter" && note.payload.kind === "text") state.editText();
        else if (event.key === "Delete" || event.key === "Backspace") {
          void adjustment.commit("keyboard");
          adjustment.remove();
        }
      }
    };
    const up = (event: KeyboardEvent) => { keys.delete(event.key); if (!keys.size) void commit(); };
    const settle = () => { void commit(); };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", settle);
    document.addEventListener("pointerdown", settle, true);
    return () => {
      window.removeEventListener("keydown", down); window.removeEventListener("keyup", up);
      window.removeEventListener("blur", settle); document.removeEventListener("pointerdown", settle, true);
    };
  }, [editor, adjustment, enabled, layerId, root]);
}

function translate(payload: AnnotationPayload, dx: number, dy: number): AnnotationPayload {
  const xs = payload.kind === "ink" ? payload.points.map(point => point.x) : [payload.x, payload.x + (payload.kind === "shape" ? payload.width : 0)];
  const ys = payload.kind === "ink" ? payload.points.map(point => point.y) : [payload.y, payload.y + (payload.kind === "shape" ? payload.height : 0)];
  dx = Math.max(-xs.reduce((minimum, value) => Math.min(minimum, value), Infinity), Math.min(1 - xs.reduce((maximum, value) => Math.max(maximum, value), -Infinity), dx));
  dy = Math.max(-ys.reduce((minimum, value) => Math.min(minimum, value), Infinity), Math.min(1 - ys.reduce((maximum, value) => Math.max(maximum, value), -Infinity), dy));
  return payload.kind === "ink" ? { ...payload, points: payload.points.map(point => ({ ...point, x: point.x + dx, y: point.y + dy })) } : { ...payload, x: payload.x + dx, y: payload.y + dy };
}
