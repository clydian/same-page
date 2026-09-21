import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useSyncExternalStore,
  type Ref,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Trash2 } from "lucide-react";

import {
  type AnnotationLayerSummary,
  type AnnotationPayload,
} from "../../shared/annotations";
import type { LocalAnnotationRecord } from "../platform/local-database";
import type { AnnotationEditor } from "./annotation-editor";
import { ObjectMovement, type MovablePayload } from "./object-movement";
import { NoteInteraction } from "./note-interaction";
import { useEditorPersistence } from "./use-annotation-editor";
import { useTextComposition } from "./use-text-composition";

import { inkSvgPaths, inkHit, inkFillRule, inkRenderingDegraded } from "./ink-geometry";
import { defaultToolStyle, type ToolStyle } from "./tool-style";
import { highlighterNibPath } from "./highlighter-geometry";
import { useSelectionKeyboard } from "./use-selection-keyboard";
import { useSelectedObjectAdjustment } from "./use-selected-object-adjustment";
import { ObjectProperties } from "./object-properties";

export type AnnotationTool = "select" | "text" | "ink" | "highlighter" | "rectangle" | "ellipse" | "eraser";
export type AnnotationOverlayInteraction =
  | "idle"
  | "composing-text"
  | "transforming-object";

const ERASER_HIT_RADIUS_PX = 14;

export interface AnnotationInteractionHandle { interrupt(): void; ownsObjectGesture(): boolean; }

export function AnnotationOverlay({
  editor,
  pageNumber,
  pageAspectRatio,
  layers,
  annotations,
  editing,
  tool,
  toolColor = tool === "highlighter" ? "#facc15" : "#dc2626",
  activeLayerId,
  toolStyle = defaultToolStyle(tool),
  onInteractionChange,
  onTextStyleChange,
  interactionRef: handoffRef,
}: {
  editor: AnnotationEditor | null;
  pageNumber: number;
  pageAspectRatio?: number;
  layers: AnnotationLayerSummary[];
  annotations: LocalAnnotationRecord[];
  editing: boolean;
  tool: AnnotationTool;
  toolColor?: string;
  toolStyle?: ToolStyle;
  onTextStyleChange?(style: Pick<ToolStyle, "fontScale" | "textAlign">): void;
  activeLayerId: string | null;
  interactionRef?: Ref<AnnotationInteractionHandle>;
  onInteractionChange?(interaction: AnnotationOverlayInteraction): void;
}) {
  const persistence = useEditorPersistence(editor);
  const notes = useMemo(() => new NoteInteraction(editor), [editor]);
  const { draftId, stroke: draftStroke, shape: draftShape, erased: erasedPreview } = useSyncExternalStore(notes.subscribe, notes.getSnapshot);
  const eraserGradientId = useId();
  const [pageWidth, setPageWidth] = useState(1000);
  const [measuredAspectRatio, setAspectRatio] = useState(1);
  const aspectRatio = pageAspectRatio ?? measuredAspectRatio;
  const [hover, setHover] = useState<Extract<AnnotationPayload, { kind: "ink" }>["points"][number] | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const movement = useMemo(() => new ObjectMovement(editor), [editor]);
  const { annotations: projectedAnnotations, preview: objectTransformPreview, transforming: transformingObject, deleteActive } = useSyncExternalStore(movement.subscribe, movement.getSnapshot);
  useLayoutEffect(() => {
    movement.reconcile(annotations);
  }, [movement, annotations]);
  const interactionRef = useRef<AnnotationOverlayInteraction>("idle");
  const deleteTargetRef = useRef<HTMLDivElement>(null);
  const finishing = persistence === "finishing";
  const canStartEdit = editing && !finishing && layers.some(layer => layer.id === activeLayerId && layer.canEdit);
  const canMoveObjects = canStartEdit && ["select", "text", "rectangle", "ellipse"].includes(tool);
  const visibleLayerIds = new Set(
    layers
      .filter((layer) => (layer.subscribed || (editing && layer.id === activeLayerId)))
      .map((layer) => layer.id),
  );
  const layerColors = new Map(
    layers.filter(layer => layer.kind === "shared").map((layer) => [layer.id, layer.displayColor]),
  );
  const activeLayerColor = layerColors.get(activeLayerId ?? "") ?? toolColor;
  const pageAnnotations = projectedAnnotations.filter(
    (annotation) =>
      annotation.payload?.pageNumber === pageNumber &&
      visibleLayerIds.has(annotation.layerId),
  );

  const { adjustment, selected, preview: propertyPreview } = useSelectedObjectAdjustment(editor, movement,
    pageNumber, activeLayerId, editing && tool === "select" && layers.some(layer => layer.id === activeLayerId && layer.canEdit));
  const selectedId = selected?.id ?? null;

  useEffect(() => {
    const element = overlayRef.current;
    if (!element) return;
    const update = () => { const bounds = element.getBoundingClientRect(); if (bounds.height > 0) { setAspectRatio(bounds.width / bounds.height); setPageWidth(bounds.width); } };
    update();
    const observer = new ResizeObserver(update); observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => editor?.registerFinishCommit(() => notes.end("finish")), [editor, notes]);

  useEffect(() => {
    const hidden = () => { if (document.visibilityState === "hidden") notes.checkpoint(); };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", notes.checkpoint);
    return () => { notes.dispose(); document.removeEventListener("visibilitychange", hidden); window.removeEventListener("pagehide", notes.checkpoint); };
  }, [notes]);

  const updateInteraction = (interaction: AnnotationOverlayInteraction) => {
    if (interactionRef.current === interaction) return;
    interactionRef.current = interaction;
    onInteractionChange?.(interaction);
  };

  const text = useTextComposition({
    editor, pageNumber, activeLayerId, editing, toolStyle, toolColor,
    displayColor: layerColors.get(activeLayerId ?? ""),
    pageRef: overlayRef, layerName: layers.find(layer => layer.id === activeLayerId)?.name,
    onComposingChange: composing => updateInteraction(composing ? "composing-text" : "idle"),
    onDiscard: id => movement.discard(id),
    onTextStyleChange,
  });

  const editSelectedText = () => adjustment.editText(({ id, payload }) => {
    text.openExisting({ id, x: payload.x, y: payload.y, initial: payload.text, fontScale: payload.fontScale, textAlign: payload.textAlign, pageWidth, color: payload.color });
  });
  useSelectionKeyboard({ editor, adjustment, root: overlayRef, enabled: editing && layers.some(layer => layer.id === activeLayerId && layer.canEdit), layerId: activeLayerId,
    busy: () => interactionRef.current !== "idle" || movement.engaged, editText: editSelectedText });
  useEffect(() => { if (selectedId && tool === "select") overlayRef.current?.focus({ preventScroll: true }); }, [selectedId, tool]);

  useEffect(
    () => () => {
      if (interactionRef.current !== "idle") onInteractionChange?.("idle");
    },
    [onInteractionChange],
  );

  const point = (event: ReactPointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: clamp((event.clientX - bounds.left) / bounds.width),
      y: clamp((event.clientY - bounds.top) / bounds.height),
      ...(event.pressure > 0 ? { pressure: event.pressure } : {}),
      ...(event.pointerType === "pen" ? { tiltX: event.tiltX || 0, tiltY: event.tiltY || 0, twist: event.twist || 0 } : {}),
    };
  };

  const eraseAt = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!activeLayerId) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const pointer = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    for (const annotation of pageAnnotations) {
      const payload = annotation.payload;
      if (
        annotation.layerId !== activeLayerId ||
        !payload || payload.kind !== "ink" ||
        erasedPreview.has(annotation.id)
      ) {
        continue;
      }
      if (!inkHit(payload, bounds.width, bounds.height, pointer.x, pointer.y, ERASER_HIT_RADIUS_PX)) continue;
      notes.erase(event.pointerId, annotation.id);
    }
  };

  const addTransformPointer = (event: ReactPointerEvent<Element>) => {
    if (!movement.begin(event)) return;
    event.preventDefault();
    capturePointer(event.currentTarget, event.pointerId);
  };

  const beginObjectTransform = (
    event: ReactPointerEvent<HTMLButtonElement>,
    annotation: LocalAnnotationRecord,
    payload: MovablePayload,
  ) => {
    if (!canMoveObjects || editor?.getSnapshot() === "finishing" || annotation.layerId !== activeLayerId) return;
    event.stopPropagation();
    if (text.active) return;
    movement.begin(event, { id: annotation.id, layerId: annotation.layerId, payload });
    event.preventDefault();
    capturePointer(event.currentTarget, event.pointerId);
  };

  const updateObjectTransform = (event: ReactPointerEvent<Element>) => {
    const bounds = overlayRef.current?.getBoundingClientRect();
    if (!bounds) return;
    movement.move(event, bounds, deleteTargetRef.current?.getBoundingClientRect());
    if (movement.getSnapshot().transforming) updateInteraction("transforming-object");
  };

  const finishObjectTransform = (event: ReactPointerEvent<Element>) => {
    if (!movement.owns(event.pointerId)) return;
    const tapped = movement.release(event.pointerId);
    if (movement.engaged) return;
    updateInteraction("idle");
    if (!tapped) return;
    if (tool === "select") { adjustment.select(tapped.id); return; }
    if (tapped.payload.kind !== "text") return;
    const bounds = overlayRef.current?.getBoundingClientRect();
    text.openExisting({
      id: tapped.id,
      x: tapped.payload.x,
      y: tapped.payload.y,
      initial: tapped.payload.text,
      fontScale: tapped.payload.fontScale,
      textAlign: tapped.payload.textAlign,
      pageWidth: bounds?.width ?? 640,
      openingPoint: { x: event.clientX, y: event.clientY },
      color: tapped.payload.color ?? "#dc2626",
    });
  };

  const cancelObjectTransform = () => {
    movement.cancel();
    updateInteraction("idle");
  };

  const pointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!canStartEdit || editor?.getSnapshot() === "finishing" || !activeLayerId) return;
    setHover(null);
    if (movement.engaged) {
      addTransformPointer(event);
      return;
    }
    if (tool === "select") {
      const bounds = event.currentTarget.getBoundingClientRect();
      const found = [...pageAnnotations].reverse().find(annotation => annotation.layerId === activeLayerId && annotation.payload?.kind === "ink" && inkHit(annotation.payload, bounds.width, bounds.height, event.clientX - bounds.left, event.clientY - bounds.top, 8));
      adjustment.select(found?.id ?? null);
      return;
    }
    if (tool === "text") {
      capturePointer(event.currentTarget, event.pointerId);
      text.startPlacement(event, point(event));
      return;
    }
    if (tool === "eraser") {
      capturePointer(event.currentTarget, event.pointerId);
      notes.begin(event.pointerId, activeLayerId, "eraser", event.timeStamp);
      eraseAt(event);
      return;
    }
    if (notes.drawing) return;
    if (tool === "rectangle" || tool === "ellipse") {
      capturePointer(event.currentTarget, event.pointerId);
      notes.begin(event.pointerId, activeLayerId, { kind: "shape", shape: tool, pageNumber, ...point(event), width: 0, height: 0, strokeWidth: toolStyle.strokeWidth, color: toolColor }, event.timeStamp);
      return;
    }
    if (tool !== "ink" && tool !== "highlighter") return;
    capturePointer(event.currentTarget, event.pointerId);
    const position = point(event);
    const initialStroke: Extract<AnnotationPayload, { kind: "ink" }> = {
      kind: "ink",
      pageNumber,
      points: [position, position],
      brush: tool === "highlighter" ? "highlighter" : "pen",
      nib: tool === "highlighter" ? toolStyle.nib : "round",
      pressureMode: tool === "ink" ? toolStyle.pressureMode : "uniform",
      strokeWidth: toolStyle.strokeWidth,
      opacity: tool === "highlighter" ? toolStyle.opacity : 1,
      color: toolColor,
    };
    notes.begin(event.pointerId, activeLayerId, initialStroke, event.timeStamp);
  };

  const pointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (editor?.getSnapshot() === "finishing") return;
    if (canStartEdit && event.pointerType === "pen" && event.buttons === 0 && !notes.drawing && !text.isPlacing() && !movement.engaged) {
      setHover(point(event)); return;
    }
    setHover(null);
    if (text.movePlacement(event)) return;
    if (movement.owns(event.pointerId)) {
      updateObjectTransform(event);
      return;
    }
    if (editing && tool === "eraser" && notes.erasing(event.pointerId)) {
      eraseAt(event);
      return;
    }
    if (editing) notes.move(event.pointerId, point(event), event.timeStamp);

  };

  const pointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (editor?.getSnapshot() === "finishing") return;
    if (text.endPlacement(event)) return;
    if (movement.owns(event.pointerId)) {
      finishObjectTransform(event);
      return;
    }
    if (!notes.owns(event.pointerId)) return;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    void notes.end(event.type === "pointercancel" ? "pointercancel" : "release", event.pointerId, point(event));
  };

  const interrupt = () => {
    setHover(null);
    text.interruptPlacement();
    cancelObjectTransform();
    void notes.end("interrupt");
  };
  // Layout capture invokes this synchronously before the second touch can edit.
  useEffect(() => editing ? editor?.registerNavigationInterrupt(() => {
    if (movement.engaged) return false;
    interrupt();
    return true;
  }) : undefined);
  useImperativeHandle(handoffRef, () => ({ interrupt, ownsObjectGesture: () => movement.engaged }));

  const previousTool = useRef(tool);
  useLayoutEffect(() => {
    if (previousTool.current === tool) return;
    previousTool.current = tool;
    // Retire the previous pointer interaction before the new tool can paint.
    interrupt();
  });

  return (
    <>
      <div
        className="annotation-overlay"
        data-editing={editing || undefined}
        data-tool={editing ? tool : undefined}
        ref={overlayRef}
      tabIndex={-1}
      >
      <svg
        aria-label={`第 ${pageNumber} 页笔记层`}
        viewBox="0 0 1000 1000"
        preserveAspectRatio="none"
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerLeave={() => setHover(null)}
        onPointerUp={pointerUp}
        onPointerCancel={(event) => {
          if (text.endPlacement(event)) return;
          if (movement.owns(event.pointerId)) cancelObjectTransform();
          else pointerUp(event);
        }}
      >
        {pageAnnotations.map((annotation) => {
          if (erasedPreview.has(annotation.id)) return null;
          const payload = tool === "select" && propertyPreview?.id === annotation.id && selectedId === annotation.id ? propertyPreview.payload : annotation.payload;
          const color = layerColors.get(annotation.layerId) ?? payload?.color ?? "#dc2626";
          const reference = editing && annotation.layerId !== activeLayerId;
          const selectable = canStartEdit && !reference && tool === "select";
          if (payload?.kind === "shape") {
            const position = objectTransformPreview?.id === annotation.id && objectTransformPreview.payload.kind === "shape"
              ? objectTransformPreview.payload : payload;
            return <g key={annotation.id} opacity={reference ? 0.45 : 1} pointerEvents={reference ? "none" : undefined}><ShapePreview payload={position} color={color} /></g>;
          }
          if (payload?.kind !== "ink" || annotation.id === draftId) return null;
          return (
            <g key={annotation.id} opacity={reference ? 0.45 : 1} pointerEvents={reference ? "none" : undefined} role={selectable ? "button" : undefined} tabIndex={selectable ? 0 : undefined} aria-label={selectable ? payload.brush === "highlighter" ? "荧光笔笔记" : "画笔笔记" : undefined} onKeyDown={event => { if (selectable && selectedId !== annotation.id && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); adjustment.select(annotation.id); } }}>
              {editing && tool === "eraser" && annotation.layerId === activeLayerId ? (
                <polyline
                  aria-hidden="true"
                  data-eraser-hit-target
                  points={payload.points.map((entry) => `${entry.x * 1000},${entry.y * 1000}`).join(" ")}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={ERASER_HIT_RADIUS_PX * 2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              ) : null}
              {inkSvgPaths(payload, aspectRatio).map((path, index) => <path key={index} data-ink-stroke d={path} fill={color} fillRule={inkFillRule(payload, aspectRatio)} opacity={payload.opacity ?? 1} />)}
              {inkRenderingDegraded(payload, aspectRatio) && <text x={payload.points[0]!.x * 1000} y={payload.points[0]!.y * 1000 - 12} fontSize="14" fill="#92400e" role="status">此笔迹已简化显示</text>}
              {selectedId === annotation.id && tool === "select" && <path d={inkSvgPaths(payload, aspectRatio).join("")} fill="none" stroke="#014653" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeDasharray="4 3" />}

            </g>
          );
        })}
        {editing && draftShape ? <ShapePreview payload={draftShape} color={activeLayerColor} /> : null}
        {editing && draftStroke ? (
          <g>{inkSvgPaths(draftStroke, aspectRatio).map((path, index) => <path key={index} data-ink-draft d={path} fill={activeLayerColor} fillRule={inkFillRule(draftStroke, aspectRatio)} opacity={draftStroke.opacity ?? 1} />)}</g>
        ) : null}
        {hover && canStartEdit && <g pointerEvents="none" aria-label="笔尖预览">
          {tool === "eraser" && <defs>
            <radialGradient id={eraserGradientId}>
              <stop offset="0" stopColor="#203b3b" />
              <stop offset="45%" stopColor="#203b3b" stopOpacity=".45" />
              <stop offset="75%" stopColor="#203b3b" stopOpacity=".12" />
              <stop offset="100%" stopColor="#203b3b" stopOpacity="0" />
            </radialGradient>
          </defs>}
          {tool === "highlighter" ? <path d={highlighterNibPath({ nib: toolStyle.nib, strokeWidth: toolStyle.strokeWidth }, hover, aspectRatio)} fill={activeLayerColor} fillOpacity={Math.min(toolStyle.opacity, .3)} /> : <ellipse
            cx={hover.x * 1000} cy={hover.y * 1000}
            rx={(tool === "eraser" ? ERASER_HIT_RADIUS_PX : 1.25) * 1000 / pageWidth}
            ry={(tool === "eraser" ? ERASER_HIT_RADIUS_PX : 1.25) * 1000 / pageWidth * aspectRatio}
            fill={tool === "eraser" ? `url(#${eraserGradientId})` : activeLayerColor}
            fillOpacity={tool === "eraser" ? .12 : .35}
          />}
        </g>}
      </svg>

      {pageAnnotations.map((annotation) => {
        const payload = tool === "select" && propertyPreview?.id === annotation.id && selectedId === annotation.id ? propertyPreview.payload : annotation.payload;
        if (payload?.kind !== "text" && payload?.kind !== "shape") return null;
        const position = objectTransformPreview?.id === annotation.id
          ? objectTransformPreview.payload
          : payload;
        return (
          <button
            aria-hidden={annotation.id === text.editingId || undefined}
            className={payload.kind === "text" ? "annotation-text" : "annotation-shape"}
            aria-label={payload.kind === "shape" ? payload.shape === "rectangle" ? "矩形笔记" : "椭圆笔记" : undefined}
            style={{
              visibility: annotation.id === text.editingId ? "hidden" : undefined,
              opacity: editing && annotation.layerId !== activeLayerId ? 0.45 : 1,
              left: `${position.x * 100}%`,
              top: `${position.y * 100}%`,
              color: layerColors.get(annotation.layerId) ?? payload.color ?? "#dc2626",
              ...(position.kind === "text" ? { fontSize: `${position.fontScale * 100}cqw`, textAlign: position.textAlign ?? "center" } : {
                width: `${position.width * 100}%`, height: `${position.height * 100}%`,
              }),
            }}
            data-transforming={objectTransformPreview?.id === annotation.id || undefined}
            data-selected={selectedId === annotation.id && tool === "select" || undefined}
            key={annotation.id}
            disabled={!canMoveObjects || annotation.layerId !== activeLayerId}
            onPointerDown={(event) => beginObjectTransform(event, annotation, payload)}
            onPointerMove={updateObjectTransform}
            onPointerUp={finishObjectTransform}
            onPointerCancel={cancelObjectTransform}
            onKeyDown={(event) => {
              if (tool === "select" && selectedId !== annotation.id && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); adjustment.select(annotation.id); }

            }}
          >
            {payload.kind === "text" ? payload.text : null}
          </button>
        );
      })}

      </div>
      {editing ? createPortal(
        <>
          {(canStartEdit || finishing) && tool === "select" && selected?.payload && editor && <ObjectProperties editor={editor} layerId={selected.layerId} key={selected.id} payload={selected.payload} adjustment={adjustment} disabled={finishing || persistence === "failed"} personal={!layerColors.has(selected.layerId)} onEditText={editSelectedText} />}
          {!canStartEdit && !finishing && <aside className="annotation-storage-error" role="status">
            <strong>此层已停止编辑</strong>
            <p>共享层已停用、删除或权限已改变。当前输入可完成并保存在原层的本机草稿中；不会上传或转写其他层。</p>
          </aside>}
          {persistence === "failed" && <aside className="annotation-storage-error" role="alert">
            <strong>本机保存失败</strong>
            <p>修改仍留在当前编辑器，尚未可靠保存。请保留此页面，释放设备空间后重试。</p>
            <button type="button" onClick={() => void editor?.retry()}>重试本机保存</button>
          </aside>}
          <div
            aria-hidden={transformingObject ? undefined : "true"}
            aria-label="拖到这里删除"
            className="annotation-delete-zone"
            data-active={deleteActive || undefined}
            data-visible={transformingObject || undefined}
            ref={deleteTargetRef}
            role="status"
          >
            <Trash2 aria-hidden="true" />
          </div>

          {text.form}
        </>,
        document.body,
      ) : null}
    </>
  );
}

function capturePointer(element: Element, pointerId: number) {
  try {
    element.setPointerCapture?.(pointerId);
  } catch {
    // Synthetic pointer events used by tests and visual QA have no active browser pointer.
  }
}

function clamp(value: number) {
  return clampRange(value, 0, 1);
}

function clampRange(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function ShapePreview({ payload, color }: { payload: Extract<AnnotationPayload, { kind: "shape" }>; color: string }) {
  const props = { fill: "none", stroke: color, strokeWidth: `${payload.strokeWidth * 100}cqw`, vectorEffect: "non-scaling-stroke" };
  return payload.shape === "rectangle"
    ? <rect {...props} x={payload.x * 1000} y={payload.y * 1000} width={payload.width * 1000} height={payload.height * 1000} />
    : <ellipse {...props} cx={(payload.x + payload.width / 2) * 1000} cy={(payload.y + payload.height / 2) * 1000} rx={payload.width * 500} ry={payload.height * 500} />;
}
