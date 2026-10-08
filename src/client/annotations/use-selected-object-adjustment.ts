import { useLayoutEffect, useMemo, useSyncExternalStore } from "react";
import type { AnnotationEditor } from "./annotation-editor";
import type { ObjectMovement } from "./object-movement";
import { SelectedObjectAdjustment } from "./selected-object-adjustment";

export function useSelectedObjectAdjustment(editor: AnnotationEditor | null, movement: ObjectMovement,
  pageNumber: number, layerId: string | null, enabled: boolean) {
  const adjustment = useMemo(() => new SelectedObjectAdjustment(editor, movement, { pageNumber, layerId, enabled }),
    [editor, movement, pageNumber, layerId, enabled]);
  useLayoutEffect(() => adjustment.connect(), [adjustment]);
  const snapshot = useSyncExternalStore(adjustment.subscribe, adjustment.getSnapshot);
  return { adjustment, ...snapshot };
}
