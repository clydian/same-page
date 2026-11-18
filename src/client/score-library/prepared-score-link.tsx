import { useMessages } from "../../i18n";
import { FeedbackMessage } from "../components/feedback-message";
import { useFeedbackMessage } from "../components/use-feedback-message";
import { readerHref } from "../reader/reader-entry";
import { useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useNavigate } from "react-router-dom";
import type { ScoreSummary } from "../../shared/scores";
import { guestOwnerSystemKey, localDatabase } from "../platform/local-database";
import { authenticatedLocalOwnerKey, createLocalWorkspace, experienceOwnerKey, resolveLocalWorkspace, type LocalWorkspaceOwnerKey } from "../platform/local-workspace";
import { untilAborted } from "../platform/abortable";
import { useOfflineScore } from "../offline/use-offline-score";
import { acquireReaderDocument } from "../reader/reader-document-cache";
import { loadPdfDocument, type PdfDocumentSource, type PdfLoadProgress } from "../reader/pdf-document";
import { acquireScorePdf } from "../offline/score-pdf-download";
import { pdfFailureCategory } from "../diagnostics/diagnostics";
import { ScoreLink } from "./score-link";
import { ScoreDownloadProgress } from "./score-download-progress";
import "./prepared-score-link.css";

type OpenRequest = { cancel: () => void };
let activeOpening: OpenRequest | null = null;
type Props = Omit<ComponentProps<typeof ScoreLink>, "onOpen" | "children"> & { children: ReactNode | ((opening: boolean, percent: number | null) => ReactNode); score: ScoreSummary; sessionId: string | null; onOpen: (scrollY?: number) => void };
export function PreparedScoreLink({ score, sessionId, children, ...props }: Props) {
  const t = useMessages("library");
  const navigate = useNavigate();
  const guestOwner = useLiveQuery(async () => (await localDatabase.system.get(guestOwnerSystemKey(score.choirId)))?.value ?? null, [score.choirId]);
  const owner = props.userId ? authenticatedLocalOwnerKey(props.userId) : guestOwner as LocalWorkspaceOwnerKey | null;
  const workspace = owner ? createLocalWorkspace(props.experience ? experienceOwnerKey(owner) : owner, score.choirId, score.id) : null;
  const offline = useOfflineScore(workspace);
  const [opening, setOpening] = useState(false);
  const [progress, setProgress] = useState<PdfLoadProgress | null>(null);
  const percent = opening && progress?.phase === "file" && progress.totalBytes && progress.loadedBytes !== null
    ? Math.min(100, Math.floor(progress.loadedBytes / progress.totalBytes * 100)) : null;
  const container = useRef<HTMLDivElement>(null);
  const feedback = useFeedbackMessage();
  const { setMessage } = feedback;
  const request = useRef<OpenRequest | null>(null);
  // Resolving a first guest owner is not a new selection. User, session and
  // immutable target changes always withdraw the pending navigation.
  const target = JSON.stringify([props.userId, sessionId, score.choirId, score.id, score.currentVersion.id, props.experience]);
  const [stateTarget, setStateTarget] = useState(target);
  if (stateTarget !== target) { setStateTarget(target); setOpening(false); setMessage(null); }
  useLayoutEffect(() => () => { request.current?.cancel(); request.current = null; }, [target]);
  const ready = offline?.scopeKey === workspace?.scopeKey && offline?.record && !offline.invalid;
  const open = async () => {
    if (request.current) return;
    activeOpening?.cancel();
    const scrollY = window.scrollY;
    setOpening(true); setProgress(null); setMessage(null);
    let lease: ReturnType<typeof acquireReaderDocument> | null = null;
    let task: ReturnType<typeof loadPdfDocument> | null = null;
    const abort = new AbortController();
    let cancelled = false;
    const release = () => { lease?.release(); if (task) void task.destroy().catch(() => undefined); };
    const current: OpenRequest = { cancel: () => {
      if (cancelled) return;
      cancelled = true; abort.abort(); release();
      if (request.current === current) { request.current = null; setOpening(false); }
      if (activeOpening === current) activeOpening = null;
    } };
    request.current = current;
    activeOpening = current;
    try {
      // Resolve first-visit guest ownership for the same cache the reader uses.
      // Slow/unavailable local storage must not prevent loading an online PDF.
      const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(100)]);
      const targetWorkspace = workspace ?? await untilAborted(resolveLocalWorkspace({
        authenticatedUserId: null, experience: props.experience, choirId: score.choirId, scoreId: score.id, signal,
      }), signal).catch(() => null);
      if (cancelled || activeOpening !== current) return;
      const source: PdfDocumentSource = async (loadingSignal, report) => {
        const download = acquireScorePdf(targetWorkspace?.ownerKey ?? "online:guest", score, value => report({ phase: "file", ...value }), AbortSignal.any([abort.signal, loadingSignal]));
        try {
          // PDF.js may transfer its input buffer. Each decoder gets a copy;
          // the shared bytes remain intact for offline saving.
          return (await download.promise).slice(0);
        } finally { download.release(); }
      };
      const onProgress = (value: PdfLoadProgress) => { if (!cancelled && activeOpening === current) setProgress(value); };
      lease = targetWorkspace ? acquireReaderDocument({ ...targetWorkspace, source, sourceKind: "cloud", versionId: score.currentVersion.id, onProgress }) : null;
      task = lease ? null : loadPdfDocument(source, score.currentVersion.id, onProgress);
      await (lease?.promise ?? task!.promise);
      if (cancelled || activeOpening !== current) return;
      props.onOpen(scrollY);
      void navigate(readerHref({ choirId: score.choirId, scoreId: score.id, experience: props.experience === true }));
    } catch (error) {
      if (!cancelled && activeOpening === current) setMessage(pdfFailureCategory(error) === "network"
        ? t("scoreOpenNetworkRetry") : t("scoreOpenRetry"), { duration: 8000 });
    } finally {
      if (!cancelled) release();
      if (activeOpening === current) activeOpening = null;
      if (request.current === current) { request.current = null; setOpening(false); }
    }
  };
  return <div ref={container} className="prepared-score-open">
    <div className="prepared-score-target" aria-busy={opening || undefined}>
      <ScoreLink {...props} onClick={event => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || props.local || ready) return;
        event.preventDefault();
        void open();
      }} onOpen={() => { activeOpening?.cancel(); props.onOpen(); }}>{typeof children === "function" ? children(opening, percent) : children}</ScoreLink>
    </div>
    <span className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">{opening ? t("scoreOpeningNamed", { name: props.label }) : ""}</span>
    {percent !== null && <span className="prepared-score-progress"><ScoreDownloadProgress percent={percent} /></span>}
    {opening && <button type="button" className="prepared-score-cancel" aria-label={t("scoreCancelOpeningNamed", { name: props.label })} onClick={() => {
      request.current?.cancel(); request.current = null; setOpening(false); container.current?.querySelector("a")?.focus();
    }}>{t("cancel")}</button>}
    <FeedbackMessage feedback={feedback} closeLabel={t("scoreCloseOpenFeedback")} />
  </div>;
}
