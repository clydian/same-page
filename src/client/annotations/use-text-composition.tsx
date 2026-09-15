import { type PointerEvent as ReactPointerEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { DEFAULT_TEXT_FONT_SCALE, MIN_TEXT_FONT_SCALE, type AnnotationPayload } from "../../shared/annotations";
import type { AnnotationEditor } from "./annotation-editor";
import { useEditorPersistence } from "./use-annotation-editor";
import { calculateTextEditorLayout } from "./text-editor-layout";
import { TextAlignment, TextSizeInput } from "./style-fields";
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
export function useTextComposition({ editor, pageNumber, activeLayerId, editing, toolStyle, toolColor, displayColor, onComposingChange, onDiscard, onTextStyleChange }: {
  editor: AnnotationEditor | null;
  pageNumber: number;
  activeLayerId: string | null;
  editing: boolean;
  toolStyle: ToolStyle;
  toolColor: string;
  displayColor?: string;
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
  const textComposerHeaderRef = useRef<HTMLElement>(null);
  const pendingTextPlacement = useRef<PendingTextPlacement | null>(null);
  const openingPoint = useRef<{ x: number; y: number } | null>(null);
  const backdropPointer = useRef<number | null>(null);
  const backdropReleased = useRef(false);
  const textSelection = useRef<TextSelection | null>(null);
  const editorFontSize = textEditor
    ? textEditor.pageWidth * editorFontScale
    : 12;
  const editorFontScaleProgress =
    (editorFontScale - MIN_TEXT_FONT_SCALE) /
    (0.032 - MIN_TEXT_FONT_SCALE);
  useLayoutEffect(() => {
    const input = textInputRef.current;
    if (!input || !textEditor) return;
    const headerBottom =
      textComposerHeaderRef.current?.getBoundingClientRect().bottom ?? 0;
    input.style.height = "auto";
    const contentHeight = input.scrollHeight;
    const layout = calculateTextEditorLayout({
      fontSize: editorFontSize,
      contentHeight,
      viewportHeight: visualViewport.height,
      viewportTop: visualViewport.top,
      headerBottom,
    });
    input.style.height = `${layout.height}px`;
    input.style.overflowY = layout.overflowY;
    if (layout.overflowY === "auto" && input.selectionEnd === input.value.length) {
      input.scrollTop = contentHeight;
    }
  }, [
    editorFontSize,
    editorText,
    textEditor,
    visualViewport.height,
    visualViewport.top,
    visualViewport.width,
  ]);

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
        x: textDraft.x,
        y: textDraft.y,
        fontScale: editorFontScale,
        textAlign: editorTextAlign,
        color: textDraft.color ?? toolColor,
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
        <header ref={textComposerHeaderRef}>
          <button
            tabIndex={textEditor ? 0 : -1}
            type="button"
            disabled={textSaving || finishing}
            onClick={cancelTextEditor}
          >
            取消
          </button>
          {textEditor && <TextAlignment value={editorTextAlign} onChange={setEditorTextAlign} />}
          <button tabIndex={textEditor ? 0 : -1} disabled={textSaving || finishing} type="submit">完成</button>
        </header>
        {textEditor ? (
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
              color: displayColor ?? textEditor.color ?? toolColor,
              fontSize: editorFontSize,
              textAlign: editorTextAlign,
            }}
            value={editorText}
            onChange={(event) => { if (editor?.getSnapshot() === "finishing") return; openingPoint.current = null; setEditorText(event.target.value); }}
            onKeyDown={(event) => {
              if (editor?.getSnapshot() === "finishing") return;
              if (event.key === "Escape") {
                event.preventDefault();
                cancelTextEditor();
              } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void finishTextEditor();
              }
            }}
          />
        ) : null}
        <div className="annotation-font-scale">
          <TextSizeInput className="annotation-font-scale__value" disabled={textSaving || finishing}
            value={editorFontScale} onChange={setEditorFontScale} />
          <span className="annotation-font-scale__control">
            <span aria-hidden="true" className="annotation-font-scale__track" />
            <span
              aria-hidden="true"
              className="annotation-font-scale__thumb"
              style={{ bottom: `${Math.min(1, editorFontScaleProgress) * 100}%` }}
            />
            <input
              aria-label="字号"
              type="range"
            disabled={textSaving || finishing}
              min={MIN_TEXT_FONT_SCALE}
              max={0.032}
              step="0.001"
              value={Math.min(0.032, editorFontScale)}
              onChange={(event) => setEditorFontScale(Number(event.target.value))}
              onPointerDown={() => {
                const input = textInputRef.current;
                textSelection.current = input
                  ? {
                      start: input.selectionStart,
                      end: input.selectionEnd,
                      direction: input.selectionDirection,
                    }
                  : null;
              }}
              onPointerCancel={() => {
                focusTextInput(textSelection.current);
              }}
              onPointerUp={() => {
                focusTextInput(textSelection.current);
              }}
            />
          </span>
        </div>
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

