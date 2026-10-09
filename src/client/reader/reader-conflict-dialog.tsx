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
  const { conflicts, online, onRefresh, onClose } = props;
  const [selectedId, setSelectedId] = useState(conflicts[0]?.opId);
  const [refreshResult, setRefreshResult] = useState<{ request: Props["onRefresh"]; ok: boolean; checkedAt: number } | null>(null);
  const refresh = !online ? "offline" : refreshResult?.request !== onRefresh ? "checking" : refreshResult.ok ? "checked" : "failed";
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
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
      setMessage(outcome === "conflict-changed" ? "笔记又有变化，请重新比较并选择。" :
        outcome === "failed" || outcome === null ? "处理未完成，本机内容保留，请重试。" :
        outcome === "local-saved" ? "选择已保存在本机，等待同步。" : null);
      return outcome;
    } finally { setBusy(false); }
  };
  return <ModalOverlay className="modal-overlay conflict-backdrop" isOpen isDismissable={!busy} isKeyboardDismissDisabled={busy}
    onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <Modal className="conflict-modal">
      <Dialog ref={dialog} aria-label="比较冲突笔记" className="conflict-dialog" exitDisabled={busy}>
        <header className="conflict-header"><div><h2>比较笔记</h2><span>{conflict ? `${index + 1} / ${conflicts.length}` : "已处理"}</span></div>
          <Button className="reader-icon-button" aria-label="关闭笔记比较" isDisabled={busy} onPress={onClose}><X size={20} /></Button></header>
        {conflict ? <>
          <div className="conflict-context"><span>{props.layers.find(layer => layer.id === conflict.layerId)?.name ?? "原图层不可用"}</span>
            <span>{!online ? "离线 · 显示已保存的云端快照" : refresh === "checking" ? "正在核对云端…" : refresh === "failed" ? "未能核对云端 · 显示已保存的快照" : `已核对云端 · ${formatConflictTime(refreshResult?.checkedAt)}`}</span></div>
          <ConflictComparison key={conflictFingerprint(conflict)} {...props} conflict={conflict} busy={busy}
            onResolve={resolve} blocked={online && refresh !== "checked"} />
          {message && <p role="status" className="conflict-message">{message}</p>}
          <footer className="conflict-footer"><Button className="secondary-button" isDisabled={busy} onPress={onClose}>稍后处理</Button>
            {refresh === "failed" && online && <Button className="secondary-button" isDisabled={busy} onPress={() => {
              setRefreshResult(null); void onRefresh().then(ok => setRefreshResult({ request: onRefresh, ok, checkedAt: Date.now() }));
            }}>重新核对</Button>}
            <div><Button className="reader-icon-button" aria-label="上一条冲突" isDisabled={busy || index === 0} onPress={() => { setSelectedId(conflicts[index - 1].opId); setMessage(null); }}><ChevronLeft size={20} /></Button>
              <Button className="reader-icon-button" aria-label="下一条冲突" isDisabled={busy || index === conflicts.length - 1} onPress={() => { setSelectedId(conflicts[index + 1].opId); setMessage(null); }}><ChevronRight size={20} /></Button></div>
          </footer>
        </> : <><p role="status">这份乐谱的本机冲突已处理。</p>{message && <p role="status">{message}</p>}
          {props.syncStatus.message && <p role="status">{props.syncStatus.message}</p>}
          <div className="conflict-complete-actions">
            {props.syncStatus.kind !== "quiet" && <Button className="secondary-button" isDisabled={busy || !props.canRetry} onPress={() => {
              setBusy(true); setMessage(null); void props.onRetry().finally(() => setBusy(false));
            }}>{busy ? "正在同步…" : "重试同步"}</Button>}
            <Button className="primary-button" isDisabled={busy} onPress={onClose}>返回看谱</Button>
          </div></>}
      </Dialog>
    </Modal>
  </ModalOverlay>;
}

function ConflictComparison({ conflict, document, layers, annotations, online, busy, blocked, onResolve }: Props & {
  conflict: AnnotationConflictRecord; busy: boolean; blocked: boolean;
}) {
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
    <div className="conflict-source-switch" role="group" aria-label="预览版本">
      <Button aria-pressed={source === "local"} isDisabled={busy} onPress={() => setSource("local")}>本机修改{localPage ? ` · 第 ${localPage} 页` : ""}</Button>
      <Button aria-pressed={source === "cloud"} isDisabled={busy} onPress={() => setSource("cloud")}>云端版本{cloudPage ? ` · 第 ${cloudPage} 页` : ""}</Button>
    </div>
    {page !== null && page >= 1 && page <= document.numPages ? <ConflictPreview
      key={page} document={document} page={page} conflict={conflict} layers={layers}
      references={annotations.filter(annotation => annotation.id !== conflict.annotationId && !annotation.deleted)}
      target={preview} /> : <div className="conflict-missing-page" role="status">{page ? `当前 PDF 没有第 ${page} 页，无法显示原谱位置。` : "没有可定位的谱面位置。"}</div>}
    <div className="conflict-variant-detail" aria-live="polite">
      <strong>{deleted ? source === "local" ? "本机已删除这条笔记" : "云端已删除这条笔记" : source === "local" ? "本机修改 · 尚未上传" : `云端版本${conflict.canonical?.updatedByDisplayName ? ` · ${conflict.canonical.updatedByDisplayName}` : ""}`}</strong>
      {source === "cloud" && <span>{conflict.canonical ? `云端修改于 ${formatConflictTime(conflict.canonical.updatedAt, true)}` : "云端快照时间未知"}{!online ? " · 快照核对时间未知，联网后可重新核对" : ""}</span>}
      {!deleted && payload?.kind === "text" && <span>{payload.text}</span>}
      {!deleted && payload?.kind === "ink" && <span>{payload.brush === "highlighter" ? "荧光笔笔记" : "画笔笔记"}</span>}
      {!deleted && payload?.kind === "shape" && <span>{payload.shape === "rectangle" ? "矩形笔记" : "椭圆笔记"}</span>}
      {deleted && !payload && <span>删除前的内容未保存在此版本中。</span>}
    </div>
    {!target && <p role="alert">本机笔记暂不可读取，请关闭后重试。</p>}
    <RadioGroup aria-label="处理这条笔记" className="conflict-choices" value={choice ?? ""} isDisabled={busy || blocked || !target}
      onChange={value => { setChoice(value as ConflictStrategy); setConfirming(false); }}>
      {choices.map(item => <Radio key={item.strategy} value={item.strategy} isDisabled={item.strategy !== "discard" && !editable}><span className="conflict-radio-mark" />{item.label}</Radio>)}
    </RadioGroup>
    {!editable && <p className="conflict-message">原图层暂不可编辑，本机内容仍保留。</p>}
    {confirming && selected ? <div className="conflict-confirm" role="group" aria-label="确认处理笔记">
      <p>{selected.consequence}{!online && choice !== "discard" ? " 联网后才会提交。" : ""}</p>
      <div><Button className="secondary-button" isDisabled={busy} onPress={() => setConfirming(false)}>返回选择</Button>
        <Button className="primary-button" isDisabled={busy || blocked || !allowed} onPress={() => {
          void onResolve(conflict.opId, selected.strategy, conflict).then(result => { if (result === "failed" || result === "conflict-changed") setConfirming(false); });
        }}>{busy ? "正在处理…" : "确认处理"}</Button></div>
    </div> : <Button className="primary-button conflict-continue" isDisabled={!selected || busy || blocked || !allowed || !target} onPress={() => setConfirming(true)}>确认选择</Button>}
  </>;
}

function ConflictPreview({ document, page, conflict, layers, references, target }: {
  document: PDFDocumentProxy; page: number; conflict: AnnotationConflictRecord;
  layers: AnnotationLayerSummary[]; references: LocalAnnotationRecord[]; target: LocalAnnotationRecord[];
}) {
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
  return <section className="conflict-preview" aria-label="原谱位置预览">
    <div className="conflict-preview-tools"><Button className="secondary-button" onPress={() => changeZoom(Math.min(1, height * ratio / width), true)}>查看整页</Button>
      <div><Button className="reader-icon-button" aria-label="缩小比较谱面" isDisabled={zoom <= .2} onPress={() => changeZoom(Math.max(.2, zoom - .4))}><Minus size={18} /></Button>
        <Button className="reader-icon-button" aria-label="放大比较谱面" isDisabled={zoom >= 3} onPress={() => changeZoom(Math.min(3, zoom + .4))}><Plus size={18} /></Button></div></div>
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

function formatConflictTime(at: number | undefined, includeDate = false) {
  return at && Number.isFinite(at) ? new Date(at).toLocaleString("zh-CN", { ...(includeDate ? { month: "numeric", day: "numeric" } : {}), hour: "2-digit", minute: "2-digit" }) : "时间未知";
}
