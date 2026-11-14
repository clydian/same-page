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
import { loadPdfDocument } from "../reader/pdf-document";
import { pdfFailureCategory } from "../diagnostics/diagnostics";
import { ScoreLink } from "./score-link";
import "./prepared-score-link.css";

type OpenRequest = { cancel: () => void };
let activeOpening: OpenRequest | null = null;
type Props = Omit<ComponentProps<typeof ScoreLink>, "onOpen" | "children"> & { children: ReactNode | ((opening: boolean) => ReactNode); score: ScoreSummary; sessionId: string | null; onOpen: (scrollY?: number) => void };
export function PreparedScoreLink({ score, sessionId, children, ...props }: Props) {
  const navigate = useNavigate();
  const guestOwner = useLiveQuery(async () => (await localDatabase.system.get(guestOwnerSystemKey(score.choirId)))?.value ?? null, [score.choirId]);
  const owner = props.userId ? authenticatedLocalOwnerKey(props.userId) : guestOwner as LocalWorkspaceOwnerKey | null;
  const workspace = owner ? createLocalWorkspace(props.experience ? experienceOwnerKey(owner) : owner, score.choirId, score.id) : null;
  const offline = useOfflineScore(workspace);
  const [opening, setOpening] = useState(false);
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
    setOpening(true); setMessage(null);
    const source = `/api/choirs/${encodeURIComponent(score.choirId)}/scores/${encodeURIComponent(score.id)}/versions/${encodeURIComponent(score.currentVersion.id)}/pdf`;
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
      lease = targetWorkspace ? acquireReaderDocument({ ...targetWorkspace, source, sourceKind: "cloud", versionId: score.currentVersion.id }) : null;
      task = lease ? null : loadPdfDocument(source, score.currentVersion.id);
      await (lease?.promise ?? task!.promise);
      if (cancelled || activeOpening !== current) return;
      props.onOpen(scrollY);
      void navigate(readerHref({ choirId: score.choirId, scoreId: score.id, experience: props.experience === true }));
    } catch (error) {
      if (!cancelled && activeOpening === current) setMessage(pdfFailureCategory(error) === "network"
        ? "乐谱未能打开，请检查网络后重试。" : "乐谱未能打开，请稍后重试。", { duration: 8000 });
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
      }} onOpen={() => { activeOpening?.cancel(); props.onOpen(); }}>{typeof children === "function" ? children(opening) : children}</ScoreLink>
    </div>
    <span className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">{opening ? `正在打开 ${props.label}` : ""}</span>
    {opening && <button type="button" className="text-button prepared-score-cancel" aria-label={`取消打开 ${props.label}`} onClick={() => {
      request.current?.cancel(); request.current = null; setOpening(false); container.current?.querySelector("a")?.focus();
    }}>取消</button>}
    <FeedbackMessage feedback={feedback} closeLabel="关闭打开提示" />
  </div>;
}
