import { useMessages } from "../../i18n";
import { ArrowLeft, TextCursorInput, Trash2, Undo2, Redo2 } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { AnnotationEditor } from "./annotation-editor";
import type { AnnotationPayload } from "../../shared/annotations";
import type { SelectedObjectAdjustment } from "./selected-object-adjustment";
import { StyleFields } from "./style-fields";
import { defaultToolStyle, type ToolStyle } from "./tool-style";

export function ObjectProperties({ payload, personal, adjustment, disabled = false, editor, layerId, onEditText }: {
  payload: AnnotationPayload; personal: boolean; adjustment: SelectedObjectAdjustment; disabled?: boolean;
  editor: AnnotationEditor; layerId: string;
  onEditText(): void;
}) {
  const t = useMessages("reader");
  const { preview } = useSyncExternalStore(adjustment.subscribe, adjustment.getSnapshot);
  const changeHistory = async (direction: "undo" | "redo") => {
    if (await adjustment.commit()) await editor[direction](layerId);
  };
  const canUndo = useSyncExternalStore(editor.subscribe, () => editor.canUndo(layerId));
  const canRedo = useSyncExternalStore(editor.subscribe, () => editor.canRedo(layerId));
  const tool = payload.kind === "ink" ? payload.brush === "highlighter" ? "highlighter" : "ink" : payload.kind === "shape" ? payload.shape : "text";
  const barRef = useRef<HTMLElement>(null);
  const [bottom, setBottom] = useState(80);
  useEffect(() => {
    const commitOutside = (event: PointerEvent) => {
      const bar = barRef.current;
      if (!bar || bar.contains(event.target as Node)) return;
      // Selection changes on pointerdown, before the browser's usual blur.
      // Flush focused inputs while their property session is still mounted.
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && bar.contains(focused)) focused.blur();
      void adjustment.commit("properties");
    };
    document.addEventListener("pointerdown", commitOutside, true);
    return () => document.removeEventListener("pointerdown", commitOutside, true);
  }, [adjustment]);
  useEffect(() => {
    const toolbar = document.querySelector<HTMLElement>(".annotation-controls");
    if (!toolbar) return;
    const place = () => setBottom(Math.max(12, window.innerHeight - toolbar.getBoundingClientRect().top + 10));
    const observer = new ResizeObserver(place);
    observer.observe(toolbar);
    window.addEventListener("resize", place);
    place();
    return () => { observer.disconnect(); window.removeEventListener("resize", place); };
  }, []);
  const styled = (value: AnnotationPayload, style: ToolStyle): AnnotationPayload => ({
    ...value,
    ...(value.kind === "text" ? { fontScale: style.fontScale, textAlign: style.textAlign } : { strokeWidth: style.strokeWidth }),
    ...(value.kind === "ink" ? { nib: style.nib, opacity: style.opacity, pressureMode: style.pressureMode } : {}),
  });
  const label = { text: t("textNote"), ink: t("inkNote"), highlighter: t("highlighterNote"), rectangle: t("rectangularNotes"), ellipse: t("ovalNotes") }[tool];
  return <aside ref={barRef} className="annotation-object-properties" data-kind={tool} aria-label={t("selectedNoteProperties")} style={{ bottom }}>
    <header>
      <button type="button" className="annotation-property-back" aria-label={t("returnToNoteTakingTools")} disabled={disabled} onClick={() => adjustment.select(null)}><ArrowLeft size={17} aria-hidden="true" /><span>{t("backToTools")}</span></button>
      <span className="annotation-object-caption">{t("selectedNoteKind", { label })}</span>
      <div className="annotation-property-history">
        <button type="button" aria-label={t("undoSelectedLayerModifications")} disabled={disabled || (!canUndo && !preview)} onClick={() => void changeHistory("undo")}><Undo2 size={18} aria-hidden="true" /></button>
        <button type="button" aria-label={t("redoSelectedLayerChanges")} disabled={disabled || !canRedo || !!preview} onClick={() => void changeHistory("redo")}><Redo2 size={18} aria-hidden="true" /></button>
      </div>
    </header>
    <fieldset className="annotation-object-controls" disabled={disabled}>
      <div className="annotation-object-style">
        <StyleFields tool={tool} value={{ ...defaultToolStyle(tool), ...payload }} preview={false}
          onChange={style => adjustment.change("properties", value => styled(value, style))} onCommit={style => { adjustment.change("properties", value => styled(value, style)); void adjustment.commit("properties"); }} />
      </div>
      {personal && <label className="annotation-note-color" title={t("noteColor")}><span style={{ background: payload.color ?? "#dc2626" }} /><input aria-label={t("selectedNoteColor")} type="color" value={payload.color ?? "#dc2626"}
        onChange={event => adjustment.change("properties", value => ({ ...value, color: event.target.value }))} onBlur={() => { void adjustment.commit("properties"); }} /></label>}
      <div className="annotation-object-actions">
        {payload.kind === "text" && <button type="button" aria-label={t("editText")} onClick={onEditText}><TextCursorInput size={18} aria-hidden="true" /><span>{t("editText")}</span></button>}
        <button type="button" className="annotation-property-delete" aria-label={t("deleteNote")} onClick={() => adjustment.remove()}><Trash2 size={17} aria-hidden="true" /></button>
      </div>
    </fieldset>
  </aside>;
}
