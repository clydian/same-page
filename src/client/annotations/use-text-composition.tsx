import { type PointerEvent as ReactPointerEvent, type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { DEFAULT_TEXT_FONT_SCALE, type AnnotationPayload } from "../../shared/annotations";
import type { AnnotationEditor } from "./annotation-editor";
import { useEditorPersistence } from "./use-annotation-editor";
import { GripHorizontal } from "lucide-react";
import { TextSizeControl, TextAlignmentButton } from "./style-fields";
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
  const textToolbarRef = useRef<HTMLDivElement>(null);
  const textHeaderRef = useRef<HTMLDivElement>(null);
  const pendingTextPlacement = useRef<PendingTextPlacement | null>(null);
  const openingPoint = useRef<{ x: number; y: number } | null>(null);
  const backdropPointers = useRef(new Set<number>());
  const backdropTap = useRef<{ pointerId: number; x: number; y: number } | null>(null);
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
      // Reserve the safe area, hint and move handle even with a hardware keyboard. Translate
      // the paper and all layers together; annotation coordinates stay unchanged.
      if (paper && !dragging.current) {
        y -= paperPan.current;
        const safeTop = Math.max(top + 16, (textHeaderRef.current?.getBoundingClientRect().bottom ?? top) + 8);
        const safeBottom = Math.min(top + (viewport?.height ?? window.innerHeight) - 16, (textToolbarRef.current?.getBoundingClientRect().top ?? Infinity) - 56);
        const lineHeight = fontSize * 1.25;
        const oversized = textHeight > safeBottom - safeTop;
        const caretLine = input.value.slice(0, input.selectionEnd).split("\n").length - 1;
        const focusY = oversized ? y - textHeight / 2 + (caretLine + .5) * lineHeight : y;
        const half = oversized ? lineHeight / 2 : textHeight / 2;
        const delta = Math.min(0, safeBottom - focusY - half) || Math.max(0, safeTop - focusY + half);
        paperPan.current = Math.abs(delta) > .5 ? delta : 0;
        paper.style.translate = paperPan.current ? `0 ${paperPan.current}px` : "";
        y += paperPan.current;
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
    backdropPointers.current.clear();
    backdropTap.current = null;
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
      if (textDraft.source === "new" && target.editor.discard(textDraft.id)) onDiscard?.(textDraft.id);
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
    // Opening may move the paper away from the finger. Suppress the follow-up
    // mouse default that would focus that old blank position and blur the input.
    event.preventDefault();
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
          backdropPointers.current.add(event.pointerId);
          const anchor = openingPoint.current;
          const repeatedOpening = anchor && Math.hypot(event.clientX - anchor.x, event.clientY - anchor.y) <= TEXT_PLACEMENT_THRESHOLD_PX;
          const blank = event.target === event.currentTarget;
          backdropTap.current = blank && event.button === 0 && !repeatedOpening && backdropPointers.current.size === 1
            ? { pointerId: event.pointerId, x: event.clientX, y: event.clientY } : null;
          // Blank gestures must not blur native input before a deliberate tap
          // can finish (or before a failed save returns to the same draft).
          if (blank) event.preventDefault();
          else openingPoint.current = null;
        }}
        onPointerMove={(event) => {
          const tap = backdropTap.current;
          if (tap?.pointerId === event.pointerId && Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > TEXT_PLACEMENT_THRESHOLD_PX) backdropTap.current = null;
        }}
        onPointerUp={(event) => {
          backdropPointers.current.delete(event.pointerId);
          const intentional = event.target === event.currentTarget && backdropTap.current?.pointerId === event.pointerId && backdropPointers.current.size === 0;
          backdropTap.current = null;
          // Touch browsers can omit click after a native gesture sequence.
          if (intentional && editor?.getSnapshot() !== "finishing") void finishTextEditor();
        }}
        onPointerCancel={(event) => {
          backdropPointers.current.delete(event.pointerId);
          backdropTap.current = null;
        }}
      >
        {textEditor && <button type="submit" className="reader-composer-done" aria-label="完成文字输入" disabled={textSaving || finishing}>完成</button>}
        {textEditor && <div className="annotation-composer-heading" ref={textHeaderRef}>
          <p className="reader-edit-gesture-hint annotation-composer-hint"><strong>正在输入文字</strong><span className="annotation-composer-instruction">· 轻点空白处完成</span></p>
        </div>}
        <div ref={textToolbarRef} className="annotation-composer-styles" role="group" aria-label="文字样式" onPointerDown={event => {
          const input = textInputRef.current;
          textSelection.current = input ? { start: input.selectionStart, end: input.selectionEnd, direction: input.selectionDirection } : null;
          if ((event.target as HTMLElement).closest("button")) event.preventDefault();
        }} onClick={event => { if ((event.target as HTMLElement).closest("button")) focusTextInput(textSelection.current); }}>
          <span className="annotation-composer-layer"><strong>文字样式</strong><span>{displayColor && <span className="annotation-composer-layer-color" aria-hidden="true" style={{ background: displayColor }} />}{layerName ?? "我的笔记"}</span></span>
          <TextSizeControl value={editorFontScale} onChange={setEditorFontScale} disabled={textSaving || finishing} />
          <TextAlignmentButton value={editorTextAlign} onChange={setEditorTextAlign} disabled={textSaving || finishing} />
          {!displayColor && <label className="annotation-composer-color" title="文字颜色"><span style={{ background: color }} /><input aria-label="文字颜色" type="color" value={color} disabled={textSaving || finishing} onChange={event => setColor(event.target.value)} /></label>}
        </div>
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
          ><GripHorizontal size={18} /></button>
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
                void finishTextEditor();
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

