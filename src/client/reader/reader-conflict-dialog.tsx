import { FeedbackMessage } from "../components/feedback-message";
import { useFeedbackMessage } from "../components/use-feedback-message";
import { getMessages, useAppLocale, useMessages, type AppLocale } from "../../i18n";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button, Modal, ModalOverlay, Radio, RadioGroup } from "react-aria-components";
import { ChevronLeft, ChevronRight, Minus, Plus, X } from "lucide-react";
import type { AnnotationLayerSummary } from "../../shared/annotations";
import { AnnotationOverlay } from "../annotations/annotation-overlay";
import { annotationBounds, conflictChoices, conflictFingerprint, conflictPage, conflictRegion, type ConflictStrategy } from "../annotations/annotation-conflict";
import type { AnnotationConflictRecord, LocalAnnotationRecord } from "../platform/local-database";
import { Dialog } from "../navigation/overlays";
import type { PDFDocumentProxy } from "./pdf-document";
import { PdfPageCanvas } from "./pdf-page";
import { usePdfPageAspectRatio } from "./use-pdf-page-geometry";
import type { ReaderSyncOutcome, ReaderSyncStatus } from "./reader-sync-status";
import "./reader-conflict.css";

type Props = {
  conflicts: AnnotationConflictRecord[];
  document: PDFDocumentProxy;
  layers: AnnotationLayerSummary[];
  annotations: LocalAnnotationRecord[];
  online: boolean;
  onRefresh(): Promise<boolean>;
  onResolve(opId: string, strategy: ConflictStrategy, reviewed: AnnotationConflictRecord): Promise<ReaderSyncOutcome | null>;
  syncStatus: ReaderSyncStatus;
  canRetry: boolean;
  onRetry(): Promise<void>;
  onClose(): void;
};

export function ReaderConflictDialog(props: Props) {
  const t = useMessages("reader");
  const { locale } = useAppLocale();
  const { conflicts, online, onRefresh, onClose } = props;
  const [selectedId, setSelectedId] = useState(conflicts[0]?.opId);
  const [refreshResult, setRefreshResult] = useState<{ request: Props["onRefresh"]; ok: boolean; checkedAt: number } | null>(null);
  const refresh = !online ? "offline" : refreshResult?.request !== onRefresh ? "checking" : refreshResult.ok ? "checked" : "failed";
  const [busy, setBusy] = useState(false);
  const feedback = useFeedbackMessage();
  const { setMessage } = feedback;
  const index = Math.max(0, conflicts.findIndex(conflict => conflict.opId === selectedId));
  const conflict = conflicts[index];
  const dialog = useRef<HTMLDivElement>(null);
  const fingerprint = conflict ? conflictFingerprint(conflict) : null;
  // A refreshed variant replaces its focused controls. Keep keyboard dismissal
  // and focus inside the dialog when that focused control disappears.
  useLayoutEffect(() => {
    if (dialog.current && !dialog.current.contains(document.activeElement)) dialog.current.focus();
  }, [fingerprint]);
  useEffect(() => {
    let active = true;
    if (online) void onRefresh().then(ok => { if (active) setRefreshResult({ request: onRefresh, ok, checkedAt: Date.now() }); });
    return () => { active = false; };
  }, [online, onRefresh]);
  const resolve: Props["onResolve"] = async (opId, strategy, reviewed) => {
    setBusy(true); setMessage(null);
    try {
      const outcome = await props.onResolve(opId, strategy, reviewed);
      if (outcome === "local-saved") setMessage(t("resolveConflictSaved"), { duration: 5000 });
      else if (outcome === "conflict-changed") setMessage(t("resolveConflictChanged"));
      else if (outcome === "failed" || outcome === null) setMessage(t("resolveConflictFailed"));
      return outcome;
    } finally { setBusy(false); }
  };
  return <ModalOverlay className="modal-overlay conflict-backdrop" isOpen isDismissable={!busy} isKeyboardDismissDisabled={busy}
    onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <Modal className="conflict-modal">
      <Dialog ref={dialog} aria-label={t("compareConflictingNotes")} className="conflict-dialog" exitDisabled={busy}>
        <header className="conflict-header"><div><h2>{t("compareNotes")}</h2><span>{conflict ? `${index + 1} / ${conflicts.length}` : t("resolved")}</span></div>
          <Button className="reader-icon-button" aria-label={t("closeNoteComparison")} isDisabled={busy} onPress={onClose}><X size={20} /></Button></header>
        {conflict ? <>
          <div className="conflict-context"><span>{props.layers.find(layer => layer.id === conflict.layerId)?.name ?? t("theOriginalLayerIsUnavailable")}</span>
            <span>{!online ? t("offlineCloudSnapshot") : refresh === "checking" ? t("checkingCloud") : refresh === "failed" ? t("cloudReviewFailed") : t("cloudReviewedAt", { time: formatConflictTime(locale, refreshResult?.checkedAt) })}</span></div>
          <ConflictComparison key={conflictFingerprint(conflict)} {...props} conflict={conflict} busy={busy}
            onResolve={resolve} blocked={online && refresh !== "checked"} />
          <FeedbackMessage feedback={feedback} className="conflict-message" />
          <footer className="conflict-footer"><Button className="secondary-button" isDisabled={busy} onPress={onClose}>{t("resolveLater")}</Button>
            {refresh === "failed" && online && <Button className="secondary-button" isDisabled={busy} onPress={() => {
              setRefreshResult(null); void onRefresh().then(ok => setRefreshResult({ request: onRefresh, ok, checkedAt: Date.now() }));
            }}>{t("checkAgain")}</Button>}
            <div><Button className="reader-icon-button" aria-label={t("previousConflict")} isDisabled={busy || index === 0} onPress={() => { setSelectedId(conflicts[index - 1].opId); setMessage(null); }}><ChevronLeft size={20} /></Button>
              <Button className="reader-icon-button" aria-label={t("nextConflict")} isDisabled={busy || index === conflicts.length - 1} onPress={() => { setSelectedId(conflicts[index + 1].opId); setMessage(null); }}><ChevronRight size={20} /></Button></div>
          </footer>
        </> : <><p role="status">{t("allConflictsResolved")}</p><FeedbackMessage feedback={feedback} />
          {props.syncStatus.message && <p role="status">{props.syncStatus.message}</p>}
          <div className="conflict-complete-actions">
            {props.syncStatus.kind !== "quiet" && <Button className="secondary-button" isDisabled={busy || !props.canRetry} onPress={() => {
              setBusy(true); setMessage(null); void props.onRetry().finally(() => setBusy(false));
            }}>{busy ? t("synchronizing") : t("retrySynchronization")}</Button>}
            <Button className="primary-button" isDisabled={busy} onPress={onClose}>{t("returnToScore")}</Button>
          </div></>}
      </Dialog>
    </Modal>
  </ModalOverlay>;
}

function ConflictComparison({ conflict, document, layers, annotations, online, busy, blocked, onResolve }: Props & {
  conflict: AnnotationConflictRecord; busy: boolean; blocked: boolean;
}) {
  const t = useMessages("reader");
  const { locale } = useAppLocale();
  const [source, setSource] = useState<"local" | "cloud">("local");
  const [choice, setChoice] = useState<ConflictStrategy | null>(null);
  const [confirming, setConfirming] = useState(false);
  const localPage = conflictPage(conflict, "local"), cloudPage = conflictPage(conflict, "cloud");
  const page = source === "local" ? localPage : cloudPage;
  const deleted = source === "local" ? conflict.localDeleted : !conflict.canonical || conflict.canonical.deleted;
  const payload = source === "local" ? conflict.localPayload : conflict.canonical?.payload ?? null;
  const choices = conflictChoices(conflict);
  const selected = choices.find(item => item.strategy === choice);
  const editable = layers.some(layer => layer.id === conflict.layerId && layer.canEdit);
  const allowed = choice === "discard" || editable;
  const target = annotations.find(annotation => annotation.id === conflict.annotationId);
  const preview = payload && !deleted ? [{
    ...conflict, id: conflict.annotationId, key: conflict.annotationId, version: 0, baseVersion: 0, deleted: false,
    payload, state: "synced" as const, lastOpId: null, syncErrorCode: null,
    createdByDisplayName: "", updatedByDisplayName: source === "cloud" ? conflict.canonical?.updatedByDisplayName ?? "" : "", updatedAt: 0,
  }] : [];
  return <>
    <div className="conflict-source-switch" role="group" aria-label={t("previewVersion")}>
      <Button aria-pressed={source === "local"} isDisabled={busy} onPress={() => setSource("local")}>{t("localVersion")}{localPage ? t("localConflictPage", { localPage }) : ""}</Button>
      <Button aria-pressed={source === "cloud"} isDisabled={busy} onPress={() => setSource("cloud")}>{t("cloudVersion")}{cloudPage ? t("cloudConflictPage", { cloudPage }) : ""}</Button>
    </div>
    {page !== null && page >= 1 && page <= document.numPages ? <ConflictPreview
      key={page} document={document} page={page} conflict={conflict} layers={layers}
      references={annotations.filter(annotation => annotation.id !== conflict.annotationId && !annotation.deleted)}
      target={preview} /> : <div className="conflict-missing-page" role="status">{page ? t("originalScorePageUnavailable", { page }) : t("noScorePosition")}</div>}
    <div className="conflict-variant-detail" aria-live="polite">
      <strong>{deleted ? source === "local" ? t("locallyDeletedNote") : t("cloudDeletedNote") : source === "local" ? t("localChangesNotUploaded") : t("cloudVersionAuthor", { value1: conflict.canonical?.updatedByDisplayName ? ` · ${conflict.canonical.updatedByDisplayName}` : "" })}</strong>
      {source === "cloud" && <span>{conflict.canonical ? t("cloudUpdatedAt", { time: formatConflictTime(locale, conflict.canonical.updatedAt, true) }) : t("cloudSnapshotTimeUnknown")}{!online ? t("reconnectForCloudSnapshot") : ""}</span>}
      {!deleted && payload?.kind === "text" && <span>{payload.text}</span>}
      {!deleted && payload?.kind === "ink" && <span>{payload.brush === "highlighter" ? t("highlighterNote") : t("inkNote")}</span>}
      {!deleted && payload?.kind === "shape" && <span>{payload.shape === "rectangle" ? t("rectangularNotes") : t("ovalNotes")}</span>}
      {deleted && !payload && <span>{t("deletedNoteContentMissing")}</span>}
    </div>
    {!target && <p role="alert">{t("conflictNoteReadFailed")}</p>}
    <RadioGroup aria-label={t("resolveNote")} className="conflict-choices" value={choice ?? ""} isDisabled={busy || blocked || !target}
      onChange={value => { setChoice(value as ConflictStrategy); setConfirming(false); }}>
      {choices.map(item => <Radio key={item.strategy} value={item.strategy} isDisabled={item.strategy !== "discard" && !editable}><span className="conflict-radio-mark" />{t(item.labelKey)}</Radio>)}
    </RadioGroup>
    {!editable && <p className="conflict-message">{t("layerUnavailableForEditing")}</p>}
    {confirming && selected ? <div className="conflict-confirm" role="group" aria-label={t("confirmNoteResolution")}>
      <p>{t(selected.consequenceKey)}{!online && choice !== "discard" ? t("resolveWhenOnline") : ""}</p>
      <div><Button className="secondary-button" isDisabled={busy} onPress={() => setConfirming(false)}>{t("backToChoices")}</Button>
        <Button className="primary-button" isDisabled={busy || blocked || !allowed} onPress={() => {
          void onResolve(conflict.opId, selected.strategy, conflict).then(result => { if (result === "failed" || result === "conflict-changed") setConfirming(false); });
        }}>{busy ? t("processing") : t("confirmResolution")}</Button></div>
    </div> : <Button className="primary-button conflict-continue" isDisabled={!selected || busy || blocked || !allowed || !target} onPress={() => setConfirming(true)}>{t("confirmSelection")}</Button>}
  </>;
}

function ConflictPreview({ document, page, conflict, layers, references, target }: {
  document: PDFDocumentProxy; page: number; conflict: AnnotationConflictRecord;
  layers: AnnotationLayerSummary[]; references: LocalAnnotationRecord[]; target: LocalAnnotationRecord[];
}) {
  const t = useMessages("reader");
  const ratio = usePdfPageAspectRatio(document, page);
  const viewport = useRef<HTMLDivElement>(null);
  const paper = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [zoomAdjustment, setZoomAdjustment] = useState<number | null>(null);
  const [height, setHeight] = useState(300);
  const anchor = useRef<{ x: number; y: number } | null>(null);
  const [positionRequest, setPositionRequest] = useState(0);
  const { x: regionX, y: regionY } = conflictRegion(conflict, page);
  const spans = [conflict.localPayload, conflict.canonical?.payload].filter(payload => payload?.pageNumber === page).map(payload => annotationBounds(payload!));
  const spanX = spans.length ? Math.max(...spans.map(b => b.right)) - Math.min(...spans.map(b => b.left)) : .5;
  const spanY = spans.length ? Math.max(...spans.map(b => b.bottom)) - Math.min(...spans.map(b => b.top)) : .5;
  const zoom = zoomAdjustment ?? Math.max(.2, Math.min(1.8, 1 / (spanX + .16), height * ratio / width / (spanY + .16)));
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const update = () => {
      setWidth(Math.max(1, element.clientWidth)); setHeight(Math.max(1, element.clientHeight));
    };
    update(); const observer = new ResizeObserver(update); observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const element = viewport.current, pageElement = paper.current;
    if (!element || !pageElement) return;
    const point = anchor.current ?? { x: regionX, y: regionY };
    if (point) {
      element.scrollLeft = point.x * pageElement.clientWidth - element.clientWidth / 2;
      element.scrollTop = point.y * pageElement.clientHeight - element.clientHeight / 2;
      anchor.current = null;
    }
  }, [width, ratio, zoom, regionX, regionY, positionRequest]);
  const changeZoom = (value: number, wholePage = false) => {
    const element = viewport.current, pageElement = paper.current;
    if (element && pageElement) anchor.current = wholePage ? { x: .5, y: .5 } : {
      x: (element.scrollLeft + element.clientWidth / 2) / pageElement.clientWidth,
      y: (element.scrollTop + element.clientHeight / 2) / pageElement.clientHeight,
    };
    setZoomAdjustment(value); setPositionRequest(request => request + 1);
  };
  const targetLayers = layers.map(layer => layer.id === conflict.layerId ? { ...layer, subscribed: true } : layer);
  const bounds = target[0]?.payload ? annotationBounds(target[0].payload) : null;
  return <section className="conflict-preview" aria-label={t("scorePositionPreview")}>
    <div className="conflict-preview-tools"><Button className="secondary-button" onPress={() => changeZoom(Math.min(1, height * ratio / width), true)}>{t("viewFullPage")}</Button>
      <div><Button className="reader-icon-button" aria-label={t("zoomOutComparison")} isDisabled={zoom <= .2} onPress={() => changeZoom(Math.max(.2, zoom - .4))}><Minus size={18} /></Button>
        <Button className="reader-icon-button" aria-label={t("zoomInComparison")} isDisabled={zoom >= 3} onPress={() => changeZoom(Math.min(3, zoom + .4))}><Plus size={18} /></Button></div></div>
    <div className="conflict-viewport" ref={viewport}>
      <div className="conflict-paper" ref={paper} style={{ width: width * zoom, aspectRatio: String(ratio) }}>
        <PdfPageCanvas document={document} pageNumber={page} width={width * zoom} aspectRatio={ratio} presentation={false} />
        <div className="conflict-reference"><AnnotationOverlay editor={null} layers={layers} annotations={references} pageNumber={page} pageAspectRatio={ratio} editing={false} tool="text" activeLayerId={null} /></div>
        <AnnotationOverlay editor={null} layers={targetLayers} annotations={target} pageNumber={page} pageAspectRatio={ratio} editing={false} tool="text" activeLayerId={null} />
        {bounds && target[0]?.payload?.kind !== "text" && <div className="conflict-target-outline" aria-hidden="true" style={{ left: `${bounds.left * 100}%`, top: `${bounds.top * 100}%`, width: `${(bounds.right - bounds.left) * 100}%`, height: `${(bounds.bottom - bounds.top) * 100}%` }} />}
      </div>
    </div>
  </section>;
}

function formatConflictTime(locale: AppLocale, at: number | undefined, includeDate = false) {
  const t = getMessages(locale, "reader");
  return at && Number.isFinite(at) ? new Date(at).toLocaleString(locale, { ...(includeDate ? { month: "numeric", day: "numeric" } : {}), hour: "2-digit", minute: "2-digit" }) : t("timeUnknown");
}
