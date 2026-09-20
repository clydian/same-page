import { Pencil, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AnnotationPayload } from "../../shared/annotations";
import type { AnnotationEditor } from "./annotation-editor";
import { StyleFields } from "./style-fields";
import { defaultToolStyle, type ToolStyle } from "./tool-style";

export function ObjectProperties({ payload, personal, editor, disabled = false, onPreview, onApply, onClose, onEditText, onDelete }: {
  payload: AnnotationPayload; personal: boolean; editor: AnnotationEditor | null; disabled?: boolean;
  onPreview(payload: AnnotationPayload | null): void;
  onApply(payload: AnnotationPayload): Promise<boolean>; onClose(): void; onEditText(): void; onDelete(): void;
}) {
  const tool = payload.kind === "ink" ? payload.brush === "highlighter" ? "highlighter" : "ink" : payload.kind === "shape" ? payload.shape : "text";
  const [draft, setDraft] = useState<AnnotationPayload | null>(null);
  const draftRef = useRef<AnnotationPayload | null>(null);
  const barRef = useRef<HTMLElement>(null);
  const [bottom, setBottom] = useState(80);
  const value = draft ?? payload;
  const preview = (next: AnnotationPayload) => { draftRef.current = next; setDraft(next); onPreview(next); };
  const commit = (next = draftRef.current) => {
    draftRef.current = null;
    setDraft(null);
    // Start the durable projection before clearing the transient slider preview.
    const result = next && JSON.stringify(next) !== JSON.stringify(payload) ? onApply(next) : Promise.resolve(true);
    onPreview(null);
    return result;
  };
  useEffect(() => {
    const commitOutside = (event: PointerEvent) => {
      const bar = barRef.current;
      if (!bar || bar.contains(event.target as Node)) return;
      // Selection changes on pointerdown, before the browser's usual blur.
      // Flush focused inputs while their property session is still mounted.
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && bar.contains(focused)) focused.blur();
      void commit();
    };
    document.addEventListener("pointerdown", commitOutside, true);
    return () => document.removeEventListener("pointerdown", commitOutside, true);
  });
  useEffect(() => editor?.registerFinishCommit(() => commit()));
  useEffect(() => editor?.registerNavigationGuard(() => draftRef.current === null), [editor]);
  useEffect(() => () => onPreview(null), [onPreview]);
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
  const styled = (style: ToolStyle): AnnotationPayload => ({
    ...value,
    ...(value.kind === "text" ? { fontScale: style.fontScale, textAlign: style.textAlign } : { strokeWidth: style.strokeWidth }),
    ...(value.kind === "ink" ? { nib: style.nib, opacity: style.opacity, pressureMode: style.pressureMode } : {}),
  });
  const label = { text: "文字笔记", ink: "画笔笔记", highlighter: "荧光笔笔记", rectangle: "矩形笔记", ellipse: "椭圆笔记" }[tool];
  return <aside ref={barRef} className="annotation-object-properties" data-kind={tool} aria-label="所选笔记属性" style={{ bottom }}>
    <header><span className="annotation-object-caption">{label}</span><button type="button" className="annotation-property-close" aria-label="关闭所选笔记属性" disabled={disabled} onClick={() => { void commit(); onClose(); }}><X size={17} aria-hidden="true" /></button></header>
    <fieldset className="annotation-object-controls" disabled={disabled}>
      <div className="annotation-object-style">
        <StyleFields tool={tool} value={{ ...defaultToolStyle(tool), ...value }} preview={false}
          onChange={style => preview(styled(style))} onCommit={style => { void commit(styled(style)); }} />
      </div>
      {personal && <label className="annotation-note-color" title="笔记颜色"><span style={{ background: value.color ?? "#dc2626" }} /><input aria-label="所选笔记颜色" type="color" value={value.color ?? "#dc2626"}
        onChange={event => preview({ ...value, color: event.target.value })} onBlur={() => { void commit(); }} /></label>}
      <div className="annotation-object-actions">
        {payload.kind === "text" && <button type="button" onClick={() => { if (!draftRef.current) onEditText(); else void commit().then(saved => { if (saved) onEditText(); }); }}><Pencil size={16} aria-hidden="true" /><span>编辑文字</span></button>}
        <button type="button" className="annotation-property-delete" aria-label="删除笔记" onClick={() => { draftRef.current = null; onPreview(null); onDelete(); }}><Trash2 size={17} aria-hidden="true" /></button>
      </div>
    </fieldset>
  </aside>;
}
