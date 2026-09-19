import { type PointerEvent as ReactPointerEvent, type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { DEFAULT_TEXT_FONT_SCALE, MIN_TEXT_FONT_SCALE, type AnnotationPayload } from "../../shared/annotations";
import type { AnnotationEditor } from "./annotation-editor";
import { useEditorPersistence } from "./use-annotation-editor";
import { AlignCenter, AlignLeft, AlignRight, Check, Minus, MoreHorizontal, Move, Plus, Trash2 } from "lucide-react";
import { TextSizeInput } from "./style-fields";
import type { ToolStyle } from "./tool-style";

type TextPayload = Extract<AnnotationPayload, { kind: "text" }>;
const TEXT_PLACEMENT_THRESHOLD_PX = 6;

interface TextEditorBase {
  id: string;
  x: number;
  y: number;
  initial: string;
  textAlign?: TextPayload["textAlign"];
  fontScale: number;
  pageWidth: number;
  color?: string;
  openingPoint?: { x: number; y: number };
}

type TextEditorState = TextEditorBase &
  ({ source: "new" } | { source: "existing" });

interface Composition extends TextEditorBase {
  source: "new" | "existing";
  target: { editor: AnnotationEditor; layerId: string; pageNumber: number };
  rememberStyle?: (style: Pick<ToolStyle, "fontScale" | "textAlign">) => void;
}

interface PendingTextPlacement {
  pointerId: number;
  startX: number;
  startY: number;
  editor: Composition;
  moved: boolean;
  opened: boolean;
}

interface TextSelection {
  start: number;
  end: number;
  direction: "forward" | "backward" | "none";
}

// Owns the native text interaction as well as its finish/navigation registration.
// Callers deliver intent and render the form; they do not coordinate draft flags.
export function useTextComposition({ editor, pageNumber, activeLayerId, editing, toolStyle, toolColor, displayColor, pageRef, layerName, onComposingChange, onDiscard, onTextStyleChange }: {
  editor: AnnotationEditor | null;
  pageNumber: number;
  activeLayerId: string | null;
  editing: boolean;
  toolStyle: ToolStyle;
  toolColor: string;
  displayColor?: string;
  pageRef?: RefObject<HTMLDivElement | null>;
  layerName?: string;
  onComposingChange(composing: boolean): void;
  onDiscard?(id: string): void;
  onTextStyleChange?(style: Pick<ToolStyle, "fontScale" | "textAlign">): void;
}) {
  const finishing = useEditorPersistence(editor) === "finishing";
  const visualViewport = useVisualViewport(editing);
  const [textEditor, setTextEditor] = useState<Composition | null>(null);
  const currentDraft = useRef<Composition | null>(null);
  useEffect(() => () => { currentDraft.current = null; }, []);
  const textSavingRef = useRef(false);
  const [textSaving, setTextSaving] = useState(false);
  const [editorText, setEditorText] = useState("");
  const [editorTextAlign, setEditorTextAlign] = useState<"left" | "center" | "right">("center");
  const [editorFontScale, setEditorFontScale] = useState(DEFAULT_TEXT_FONT_SCALE);
  const textInputRef = useRef<HTMLTextAreaElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [color, setColor] = useState(toolColor);
  const anchorRef = useRef<HTMLDivElement>(null);
  const paperPan = useRef(0);
  const measureRef = useRef<HTMLSpanElement>(null);
  const dragging = useRef<{ pointerId: number; x: number; y: number; origin: { x: number; y: number } } | null>(null);
  const textComposerHeaderRef = useRef<HTMLElement>(null);
  const pendingTextPlacement = useRef<PendingTextPlacement | null>(null);
  const openingPoint = useRef<{ x: number; y: number } | null>(null);
  const backdropPointer = useRef<number | null>(null);
  const backdropReleased = useRef(false);
  const textSelection = useRef<TextSelection | null>(null);
  const editorFontSize = textEditor
    ? textEditor.pageWidth * editorFontScale
    : 12;
  useLayoutEffect(() => {
    if (!textEditor) return;
    const paper = pageRef?.current?.closest<HTMLElement>(".annotated-pdf-page");
    const previous = paper?.style.translate ?? "";
    paperPan.current = 0;
    return () => { if (paper) paper.style.translate = previous; paperPan.current = 0; };
  }, [textEditor, pageRef]);

  // Measure the exact same unwrapped text block used by the saved note. Keep the
  // portal attached to page geometry even while the visual viewport is moving.
  useLayoutEffect(() => {
    if (!textEditor) return;
    const paper = pageRef?.current?.closest<HTMLElement>(".annotated-pdf-page");
    let frame = 0;
    const place = () => {
      const anchor = anchorRef.current;
      const measure = measureRef.current;
      const input = textInputRef.current;
      if (!anchor || !measure || !input) return;
      const rect = pageRef?.current?.getBoundingClientRect();
      const width = rect?.width || textEditor.pageWidth;
      const height = rect?.height || width;
      const fontSize = width * editorFontScale;
      anchor.style.fontSize = `${fontSize}px`;
      const textWidth = Math.max(2, measure.getBoundingClientRect().width);
      const textHeight = Math.max(fontSize * 1.25, measure.getBoundingClientRect().height);
      anchor.style.width = `${textWidth}px`;
      anchor.style.height = `${textHeight}px`;
      const viewport = window.visualViewport;
      const top = viewport?.offsetTop ?? 0;
      const left = viewport?.offsetLeft ?? 0;
      let y = (rect?.top ?? 0) + position.y * height;
      if (paper && (!viewport || viewport.height >= window.innerHeight - 100) && paperPan.current) {
        y -= paperPan.current;
        paperPan.current = 0;
        paper.style.translate = "";
      }
      // Translate paper and all layers together, without changing zoom or saved
      // coordinates. Restore the presentation offset when composition ends.
      if (paper && viewport && viewport.height < window.innerHeight - 100 && !dragging.current) {
        const safeTop = Math.max(top + 16, (textComposerHeaderRef.current?.getBoundingClientRect().bottom ?? top) + 24);
        const safeBottom = top + viewport.height - 32;
        const lineHeight = fontSize * 1.25;
        const oversized = textHeight > safeBottom - safeTop;
        const caretLine = input.value.slice(0, input.selectionEnd).split("\n").length - 1;
        const focusY = oversized ? y - textHeight / 2 + (caretLine + .5) * lineHeight : y;
        const half = oversized ? lineHeight / 2 : textHeight / 2;
        const delta = Math.min(0, safeBottom - focusY - half) || Math.max(0, safeTop - focusY + half);
        if (Math.abs(delta) > .5) { paperPan.current += delta; paper.style.translate = `0 ${paperPan.current}px`; y += delta; }
      }
      anchor.style.left = `${(rect?.left ?? 0) + position.x * width - left}px`;
      anchor.style.top = `${y - top}px`;
      frame = requestAnimationFrame(place);
    };
    place();
    return () => { cancelAnimationFrame(frame); };
  }, [textEditor, pageRef, position, editorFontScale, editorText]);

  const focusTextInput = (selection?: TextSelection | null) => {
    const input = textInputRef.current;
    if (!input) return;
    input.focus({ preventScroll: true });
    if (selection) {
      input.setSelectionRange(
        selection.start,
        selection.end,
        selection.direction,
      );
    }
  };

  const bindDraft = (draft: TextEditorState): Composition | null => {
    if (!editor || !activeLayerId) return null;
    return { ...draft, color: draft.color ?? toolColor,
      target: { editor, layerId: activeLayerId, pageNumber }, rememberStyle: onTextStyleChange };
  };
  const openTextEditor = (draft: Composition) => {
    if (currentDraft.current || textSavingRef.current) return;
    openingPoint.current = draft.openingPoint ?? null;
    backdropPointer.current = null;
    backdropReleased.current = false;
    currentDraft.current = draft;
    flushSync(() => {
      setEditorText(draft.initial);
      setPosition({ x: draft.x, y: draft.y });
      setColor(draft.color ?? toolColor);
      setEditorFontScale(draft.fontScale);
      setEditorTextAlign(draft.textAlign ?? "center");
      setTextEditor(draft);
      onComposingChange(true);
    });
    textInputRef.current?.setSelectionRange(draft.initial.length, draft.initial.length, "none");
  };

  const closeTextEditor = () => {
    textSelection.current = null;
    pendingTextPlacement.current = null;
    currentDraft.current = null;
    setTextEditor(null);
    onComposingChange(false);
    const input = textInputRef.current;
    if (input && input === document.activeElement) input.blur();
  };

  const cancelTextEditor = () => {
    if (textSavingRef.current) return;
    if (textEditor && textEditor.target.editor.discard(textEditor.id)) {
      onDiscard?.(textEditor.id);
    }
    closeTextEditor();
  };

  const commitTextEditor = async () => {
    if (!textEditor) return true;
    const textDraft = textEditor;
    if (currentDraft.current !== textDraft) return false;
    const target = textDraft.target;
    const text = editorText.trim();
    if (!text) {
      if (textDraft.source === "existing") {
        const saved = await target.editor.persist({
          id: textDraft.id,
          layerId: target.layerId,
          payload: null,
          deleted: true,
        });
        if (!saved || currentDraft.current !== textDraft) return false;
      }
      closeTextEditor();
      return true;
    }
    const saved = await target.editor.persist({
      id: textDraft.id,
      layerId: target.layerId,
      payload: {
        kind: "text",
        pageNumber: target.pageNumber,
        x: position.x,
        y: position.y,
        fontScale: editorFontScale,
        textAlign: editorTextAlign,
        color,
        text,
      },
    });
    if (currentDraft.current !== textDraft) return false;
    if (saved) {
      if (textDraft.source === "new") textDraft.rememberStyle?.({ fontScale: editorFontScale, textAlign: editorTextAlign });
      closeTextEditor();
    }
    return Boolean(saved);
  };

  const finishTextEditor = async () => {
    if (textSavingRef.current) return false;
    textSavingRef.current = true;
    setTextSaving(true);
    try { return await commitTextEditor(); }
    finally { textSavingRef.current = false; setTextSaving(false); }
  };

  useEffect(() => { if (editing && textEditor) return textEditor.target.editor.registerFinishCommit(finishTextEditor); });

  useEffect(() => editing ? editor?.registerNavigationGuard(() => !currentDraft.current && !textSavingRef.current) : undefined, [editing, editor]);
  const startPlacement = (event: ReactPointerEvent<SVGSVGElement>, position: { x: number; y: number }) => {
    if (textEditor || pendingTextPlacement.current) return;
    const draft = bindDraft({
      id: crypto.randomUUID(), ...position, initial: "", fontScale: toolStyle.fontScale,
      textAlign: toolStyle.textAlign, pageWidth: event.currentTarget.getBoundingClientRect().width,
      source: "new", openingPoint: { x: event.clientX, y: event.clientY }, color: toolColor,
    });
    if (!draft) return;
    pendingTextPlacement.current = {
      pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
      moved: false, opened: event.pointerType === "pen", editor: draft,
    };
    // Keep native autofocus inside the Pencil user gesture. The browser owns
    // whether this uses Scribble or the software keyboard.
    if (event.pointerType === "pen") openTextEditor(draft);
  };
  const movePlacement = (event: ReactPointerEvent<SVGSVGElement>) => {
    const pending = pendingTextPlacement.current;
    if (pending?.pointerId !== event.pointerId) return false;
    if (Math.hypot(event.clientX - pending.startX, event.clientY - pending.startY) > TEXT_PLACEMENT_THRESHOLD_PX) {
      pending.moved = true;
      if (pending.opened) { pending.opened = false; closeTextEditor(); }
    }
    return true;
  };
  const endPlacement = (event: ReactPointerEvent<SVGSVGElement>) => {
    const pending = pendingTextPlacement.current;
    if (pending?.pointerId !== event.pointerId) return false;
    pendingTextPlacement.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (event.type === "pointercancel") {
      if (pending.opened) closeTextEditor();
    } else if (!pending.moved && !pending.opened) openTextEditor(pending.editor);
    return true;
  };
  return {
    active: textEditor !== null,
    editingId: textEditor?.id,
    isPlacing: () => pendingTextPlacement.current !== null,
    openExisting: (draft: TextEditorBase) => {
      const bound = bindDraft({ ...draft, source: "existing" });
      if (bound) openTextEditor(bound);
    },
    startPlacement, movePlacement, endPlacement,
    interruptPlacement: () => { pendingTextPlacement.current = null; },
    form: (
      <form
        aria-label={textEditor ? "文字输入" : undefined}
        aria-hidden={textEditor ? undefined : "true"}
        inert={!textEditor}
        className="annotation-text-composer"
        data-active={textEditor ? "true" : undefined}
        style={{
          top: visualViewport.top,
          left: visualViewport.left,
          width: visualViewport.width,
          height: visualViewport.height,
        }}
        onSubmit={(event) => {
          event.preventDefault();
          if (editor?.getSnapshot() === "finishing") return;
          void finishTextEditor();
        }}
        onPointerDown={(event) => {
          backdropReleased.current = false;
          const anchor = openingPoint.current;
          const repeatedOpening = anchor && Math.hypot(event.clientX - anchor.x, event.clientY - anchor.y) <= TEXT_PLACEMENT_THRESHOLD_PX;
          backdropPointer.current = event.target === event.currentTarget && !repeatedOpening ? event.pointerId : null;
          if (event.target !== event.currentTarget) openingPoint.current = null;
        }}
        onPointerUp={(event) => {
          backdropReleased.current = event.target === event.currentTarget && backdropPointer.current === event.pointerId;
          backdropPointer.current = null;
        }}
        onPointerCancel={() => { backdropPointer.current = null; backdropReleased.current = false; }}
        onClick={(event) => {
          const intentional = backdropReleased.current && event.detail <= 1;
          backdropReleased.current = false;
          if (editor?.getSnapshot() !== "finishing" && event.target === event.currentTarget && intentional) void finishTextEditor();
        }}
      >
        <header ref={textComposerHeaderRef} onPointerDown={event => {
          const input = textInputRef.current;
          textSelection.current = input ? { start: input.selectionStart, end: input.selectionEnd, direction: input.selectionDirection } : null;
          if ((event.target as HTMLElement).closest("button")) event.preventDefault();
        }} onClick={event => { if ((event.target as HTMLElement).closest("button")) focusTextInput(textSelection.current); }}>
          <span className="annotation-composer-layer"><span aria-hidden="true" style={{ background: displayColor ?? color }} />{layerName ?? "我的笔记"}</span>
          <div className="annotation-composer-size" role="group" aria-label="文字字号">
            <button type="button" aria-label="减小字号" disabled={textSaving || finishing || editorFontScale <= MIN_TEXT_FONT_SCALE} onClick={() => setEditorFontScale(value => Math.max(MIN_TEXT_FONT_SCALE, value - .001))}><Minus size={17} /></button>
            <TextSizeInput className="annotation-font-scale__value" disabled={textSaving || finishing} value={editorFontScale} onChange={setEditorFontScale} />
            <button type="button" aria-label="增大字号" disabled={textSaving || finishing || editorFontScale >= .08} onClick={() => setEditorFontScale(value => Math.min(.08, value + .001))}><Plus size={17} /></button>
          </div>
          <button type="button" aria-label={`文字对齐：${{ left: "左对齐", center: "居中", right: "右对齐" }[editorTextAlign]}`} title="切换文字对齐" disabled={textSaving || finishing} onClick={() => setEditorTextAlign(value => value === "left" ? "center" : value === "center" ? "right" : "left")}>
            {editorTextAlign === "left" ? <AlignLeft size={19} /> : editorTextAlign === "right" ? <AlignRight size={19} /> : <AlignCenter size={19} />}
          </button>
          {!displayColor && <label className="annotation-composer-color" title="文字颜色"><span style={{ background: color }} /><input aria-label="文字颜色" type="color" value={color} disabled={textSaving || finishing} onChange={event => setColor(event.target.value)} /></label>}
          {textEditor?.source === "existing" && <details className="annotation-composer-more"><summary aria-label="更多文字操作"><MoreHorizontal size={19} /></summary><button type="button" disabled={textSaving || finishing} onClick={async () => {
            if (textSavingRef.current) return;
            textSavingRef.current = true; setTextSaving(true);
            try { if (await textEditor.target.editor.persist({ id: textEditor.id, layerId: textEditor.target.layerId, payload: null, deleted: true }) && currentDraft.current === textEditor) closeTextEditor(); }
            finally { textSavingRef.current = false; setTextSaving(false); }
          }}><Trash2 size={16} />删除文字</button></details>}
          <span className="annotation-composer-divider" />
          <button tabIndex={textEditor ? 0 : -1} type="button" disabled={textSaving || finishing} onClick={cancelTextEditor}>取消</button>
          <button className="annotation-composer-done" tabIndex={textEditor ? 0 : -1} disabled={textSaving || finishing} type="submit"><Check size={17} />完成</button>
        </header>
        {textEditor ? (
          <div className="annotation-text-anchor" ref={anchorRef} style={{ fontSize: editorFontSize, color: displayColor ?? color }}>
          <span ref={measureRef} className="annotation-text-measure" aria-hidden="true">{editorText || "\u200b"}{editorText.endsWith("\n") ? "\u200b" : ""}</span>
          <button className="annotation-text-move" aria-label="移动文字" type="button" disabled={textSaving || finishing}
            onPointerDown={event => {
              event.preventDefault();
              if (dragging.current) return;
              dragging.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, origin: position };
              event.currentTarget.setPointerCapture?.(event.pointerId);
            }}
            onPointerMove={event => {
              const drag = dragging.current;
              const rect = pageRef?.current?.getBoundingClientRect();
              if (!drag || drag.pointerId !== event.pointerId || !rect?.width || !rect.height) return;
              setPosition({ x: Math.max(0, Math.min(1, drag.origin.x + (event.clientX - drag.x) / rect.width)), y: Math.max(0, Math.min(1, drag.origin.y + (event.clientY - drag.y) / rect.height)) });
            }}
            onPointerUp={() => { dragging.current = null; focusTextInput(); }}
            onPointerCancel={() => { if (dragging.current) setPosition(dragging.current.origin); dragging.current = null; }}
          ><Move size={16} /></button>
          <textarea
            aria-label="笔记文本"
            autoFocus
            name="text"
            readOnly={textSaving || finishing}
            ref={textInputRef}
            inputMode="text"
            maxLength={1000}
            rows={2}
            wrap="off"
            style={{
              color: "inherit",
              fontSize: "inherit",
              textAlign: editorTextAlign,
            }}
            value={editorText}
            onChange={(event) => { if (editor?.getSnapshot() === "finishing") return; openingPoint.current = null; setEditorText(event.target.value); }}
            onKeyDown={(event) => {
              if (editor?.getSnapshot() === "finishing") return;
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Escape") {
                event.preventDefault();
                cancelTextEditor();
              } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void finishTextEditor();
              }
            }}
          />
          </div>
        ) : null}
      </form>
    ),
  };
}

function useVisualViewport(enabled: boolean) {
  const read = () => ({
    top: window.visualViewport?.offsetTop ?? 0,
    left: window.visualViewport?.offsetLeft ?? 0,
    width: window.visualViewport?.width ?? window.innerWidth,
    height: window.visualViewport?.height ?? window.innerHeight,
  });
  const [viewport, setViewport] = useState(read);
  useEffect(() => {
    if (!enabled) return;
    const target = window.visualViewport;
    const update = () => setViewport(read());
    target?.addEventListener("resize", update);
    target?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      target?.removeEventListener("resize", update);
      target?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [enabled]);
  return viewport;
}

