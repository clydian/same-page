import { useMessages } from "../../i18n";
import { useInteractOutside } from "react-aria";
import { useId, useRef, useState, useSyncExternalStore } from "react";
import { MousePointer2, SlidersHorizontal, ChevronDown, Eraser, Highlighter, Square, Circle, Lock, Pencil, Redo2, Type, Undo2, X } from "lucide-react";
import { Button,  DialogTrigger, Popover } from "react-aria-components";
import { Dialog } from "../navigation/overlays";

import {
  type AnnotationLayerSummary,
} from "../../shared/annotations";
import type { AnnotationTool } from "../annotations/annotation-overlay";
import type { AnnotationEditor } from "../annotations/annotation-editor";
import "./reader-ux.css";
import { StyleFields } from "../annotations/style-fields";
import { defaultToolStyle, type ToolStyle } from "../annotations/tool-style";

export function ReaderEditingControls({
  isDisabled,
  localOnly = false,
  editor,
  layers,
  tool,
  toolColor,
  toolStyle = defaultToolStyle(tool),
  onStyleChange = () => undefined,
  onColorChange,
  activeLayerId,
  onToolChange,
  onLayerChange,
  onOpenLayers,
}: {
  isDisabled: boolean;
  localOnly?: boolean;
  editor: AnnotationEditor;
  layers: AnnotationLayerSummary[];
  tool: AnnotationTool;
  toolColor: string;
  toolStyle?: ToolStyle;
  onStyleChange?(style: ToolStyle): void;
  onColorChange(color: string): void;
  activeLayerId: string | null;
  onToolChange(tool: AnnotationTool): void;
  onLayerChange(layerId: string): void;
  onOpenLayers?(tab: "display" | "manage"): void;
}) {
  const t = useMessages("reader");
  const styleAnchor = useRef<Element | null>(null);
  const styleDialogId = useId();
  const permissionHelpId = useId();
  const hasReadOnlyLayers = layers.some(layer => layer.kind === "shared" && !layer.canEdit);
  const stylePopover = useRef<HTMLDivElement>(null);
  const [styleSource, setStyleSource] = useState<AnnotationTool | "settings" | null>(null);
  const openStyle = (source: AnnotationTool | "settings", anchor: Element) => {
    styleAnchor.current = anchor;
    setStyleSource(current => current === source ? null : source);
  };
  const closeStyleOutside = (event: Event) => {
    if (!styleAnchor.current || !event.composedPath().includes(styleAnchor.current)) setStyleSource(null);
  };
  // Drawing gestures need not produce a click. Close at pointerdown while allowing
  // that same event to reach the score and begin the first stroke.
  useInteractOutside({ ref: stylePopover, isDisabled: styleSource === null,
    onInteractOutsideStart: closeStyleOutside, onInteractOutside: closeStyleOutside });
  const [choosingLayer, setChoosingLayer] = useState(false);
  const toolHasStyle = tool !== "eraser" && tool !== "select";
  const canUndo = useSyncExternalStore(editor.subscribe, () => editor.canUndo(activeLayerId));
  const canRedo = useSyncExternalStore(editor.subscribe, () => editor.canRedo(activeLayerId));
  const toolNames = { select: t("select"), text: t("text"), ink: t("pen"), highlighter: t("highlighter"), rectangle: t("rectangle"), ellipse: t("ellipse"), eraser: t("eraser") };
  const selectedLayer = layers.find((layer) => layer.id === activeLayerId);
  const audience = localOnly ? t("previewLocalOnly") : selectedLayer?.kind === "shared" ? t("sharedDriveVisible") : selectedLayer?.sharing ? t("personalDriveVisible") : t("personalOnly");
  const chooseLayer = (layerId: string) => {
    onLayerChange(layerId);
    setStyleSource(null);
    setChoosingLayer(false);
  };
  const personalLayers = layers.filter((layer) => layer.kind === "personal" && layer.canEdit);

  return (
    <section className="annotation-controls" aria-label={t("noteTools")}>
      <DialogTrigger isOpen={choosingLayer} onOpenChange={setChoosingLayer}>
        <Button
          isDisabled={isDisabled}
          className="reader-edit-layer-trigger"
          aria-label={t("currentEditingLayer", { layer: selectedLayer?.name ?? "", audience })}
        >
          <span className="reader-edit-layer-identity"><span>{selectedLayer?.name}</span><small>{audience}</small></span>
          <ChevronDown aria-hidden="true" size={14} />
        </Button>
        <Popover className="reader-edit-layer-popover" placement="top" offset={12}>
          <Dialog aria-label={t("chooseEditingLayer")} aria-describedby={hasReadOnlyLayers ? permissionHelpId : undefined}>
            <div className="reader-target-heading"><h2>{t("chooseEditingLayer")}</h2><Button className="icon-button" aria-label={t("closeEditingLayer")} onPress={() => setChoosingLayer(false)}><X aria-hidden="true" size={18} /></Button></div>
            <p>{t("sharedLayerAudience")}</p>
            {hasReadOnlyLayers && <p id={permissionHelpId} className="annotation-layer-permission-help">{t("requestLayerPermission")}</p>}
            <div className="annotation-layer-switcher" aria-label={t("editingLayer")}>
              {layers.filter(layer => layer.kind === "shared").map((layer) => (
                <LayerSlotButton
                  isDisabled={isDisabled}
                  key={layer.id}
                  layer={layer}
                  activeLayerId={activeLayerId}
                  onLayerChange={chooseLayer}
                />
              ))}
            </div>
            <p>{t("personalLayerAudience")}</p>
            <div className="annotation-layer-switcher">
              {personalLayers.map(layer => <LayerSlotButton key={layer.id} isDisabled={isDisabled} layer={layer} activeLayerId={activeLayerId} onLayerChange={chooseLayer} />)}
            </div>
            <div className="reader-layer-shortcuts">
              <Button onPress={() => { setChoosingLayer(false); onOpenLayers?.("display"); }}>{t("showReferenceNotes")}<span aria-hidden="true">→</span></Button>
              <Button onPress={() => { setChoosingLayer(false); onOpenLayers?.("manage"); }}>{t("managePersonalLayers")}<span aria-hidden="true">→</span></Button>
            </div>
          </Dialog>
        </Popover>
      </DialogTrigger>
      <div className="annotation-control-group annotation-drawing-tools" aria-label={t("tools")}>
        <div className="segmented-control" aria-label={t("noteTools")}>
          {(["select", "ink", "highlighter", "eraser", "text", "rectangle", "ellipse"] as const).map((entry) => (
            <Button
              isDisabled={isDisabled || !selectedLayer?.canEdit}
              aria-label={toolNames[entry]}
              aria-pressed={tool === entry}
              aria-haspopup={entry === tool && toolHasStyle ? "dialog" : undefined}
              aria-expanded={entry === tool && toolHasStyle ? styleSource === entry : undefined}
              aria-controls={styleSource === entry ? styleDialogId : undefined}
              className={`annotation-tool-button${entry === "text" || entry === "rectangle" ? " annotation-tool-divider" : ""}`}
              key={entry}
              onPress={event => {
                if (entry === tool && toolHasStyle) openStyle(entry, event.target);
                else { setStyleSource(null); onToolChange(entry); }
              }}
            >
              <AnnotationToolIcon tool={entry} />
              {tool === entry && <span className="annotation-tool-name" aria-hidden="true">{toolNames[entry]}</span>}
            </Button>
          ))}
        </div>
      </div>
      {selectedLayer?.kind === "personal" && <label className="annotation-toolbar-color"><span style={{ background: toolHasStyle ? toolColor : "#e5e7e5" }} /><input type="color" aria-label={t("toolColor")} title={toolHasStyle ? t("toolColor") : t("colorUnavailableForTool")} disabled={isDisabled || !selectedLayer.canEdit || !toolHasStyle} value={toolHasStyle ? toolColor : "#e5e7e5"} onChange={event => onColorChange(event.target.value)} /></label>}
      <Button
        className="annotation-tool-button annotation-style-trigger"
        aria-label={t("toolSettings")}
        aria-haspopup="dialog"
        aria-expanded={styleSource === "settings"}
        aria-controls={styleSource === "settings" ? styleDialogId : undefined}
        isDisabled={isDisabled || !selectedLayer?.canEdit || !toolHasStyle}
        onPress={event => openStyle("settings", event.target)}
      ><SlidersHorizontal size={20} /></Button>
      <Popover
        className="annotation-style-popover"
        ref={stylePopover}
        isNonModal
        triggerRef={styleAnchor}
        isOpen={styleSource !== null && !isDisabled && !!selectedLayer?.canEdit && toolHasStyle}
        onOpenChange={open => { if (!open) setStyleSource(null); }}
        placement="top"
        offset={12}
      >
        <Dialog id={styleDialogId} aria-label={t("toolSettings")}>
          <header className="reader-style-heading"><strong>{t("namedToolSettings", { tool: toolNames[tool] })}</strong><span>{t("newNoteStyles")}</span></header>
          <div style={{ color: selectedLayer?.kind === "shared" ? selectedLayer.displayColor : toolColor }}>
            <StyleFields tool={tool} value={toolStyle} onChange={onStyleChange} />
          </div>
        </Dialog>
      </Popover>
      <div className="annotation-control-group annotation-history-controls" aria-label={t("history")}>
        <Button
          isDisabled={isDisabled || !selectedLayer?.canEdit || !canUndo}
          aria-label={t("undo")}
          className="annotation-tool-button"
          onPress={() => activeLayerId ? void editor.undo(activeLayerId) : undefined}
        >
          <Undo2 aria-hidden="true" size={20} />
        </Button>
        <Button
          isDisabled={isDisabled || !selectedLayer?.canEdit || !canRedo}
          aria-label={t("redo")}
          className="annotation-tool-button"
          onPress={() => activeLayerId ? void editor.redo(activeLayerId) : undefined}
        >
          <Redo2 aria-hidden="true" size={20} />
        </Button>
      </div>
    </section>
  );
}

function LayerSlotButton({
  isDisabled,
  layer,
  activeLayerId,
  onLayerChange,
}: {
  isDisabled: boolean;
  layer: AnnotationLayerSummary | undefined;
  activeLayerId: string | null;
  onLayerChange(layerId: string): void;
}) {
  const t = useMessages("reader");
  const label = layer?.name ?? "";
  const button = (
    <Button
      isDisabled={isDisabled || !layer?.canEdit}
      aria-label={layer?.canEdit ? label : t("readOnlyLayerLabel", { label })}
      aria-pressed={layer?.id === activeLayerId}
      className="annotation-layer-slot"
      data-read-only={!layer?.canEdit || undefined}
      onPress={() => {
        if (layer?.canEdit) onLayerChange(layer.id);
      }}
    >
      {layer?.kind === "shared" && <i aria-hidden="true" style={{ background: layer.displayColor }} />}
      <span>{layer?.name}</span>
      {layer && !layer.canEdit ? (
        <Lock aria-hidden="true" className="annotation-layer-slot__lock" size={11} />
      ) : null}
      {layer && !layer.canEdit ? <small>{t("viewOnly")}</small> : null}
    </Button>
  );
  return button;
}

function AnnotationToolIcon({ tool }: { tool: AnnotationTool }) {
  if (tool === "select") return <MousePointer2 aria-hidden="true" size={20} />;
  if (tool === "text") return <Type aria-hidden="true" size={20} strokeWidth={2} />;
  if (tool === "ink") return <Pencil aria-hidden="true" size={20} strokeWidth={2} />;
  if (tool === "highlighter") return <Highlighter aria-hidden="true" size={20} />;
  if (tool === "rectangle") return <Square aria-hidden="true" size={20} />;
  if (tool === "ellipse") return <Circle aria-hidden="true" size={20} />;
  return <Eraser aria-hidden="true" size={20} strokeWidth={2} />;
}
