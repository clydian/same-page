import { readerHref } from "../reader/reader-entry";
import { useEffect, useRef, useState, type ComponentProps } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useNavigate } from "react-router-dom";
import type { ScoreSummary } from "../../shared/scores";
import { untilAborted } from "../platform/abortable";
import { guestOwnerSystemKey, localDatabase } from "../platform/local-database";
import { authenticatedLocalOwnerKey, createLocalWorkspace, experienceOwnerKey } from "../platform/local-workspace";
import { useOfflinePreparation, useOfflineScore } from "../offline/use-offline-score";
import { ScoreLink } from "./score-link";
import "./prepared-score-link.css";

let openingGeneration = 0;
type Props = Omit<ComponentProps<typeof ScoreLink>, "onOpen"> & { score: ScoreSummary; sessionId: string | null; canPrepare: boolean; onOpen: (scrollY?: number) => void };
export function PreparedScoreLink({ score, sessionId, canPrepare, ...props }: Props) {
  const navigate = useNavigate();
  const guestOwner = useLiveQuery(async () => (await localDatabase.system.get(guestOwnerSystemKey(score.choirId)))?.value ?? null, [score.choirId]);
  const owner = props.userId ? authenticatedLocalOwnerKey(props.userId) : guestOwner;
  // Guest ownership is established by OfflineScoreControl before opening.
  const workspace = owner ? createLocalWorkspace(props.experience ? experienceOwnerKey(owner as Parameters<typeof createLocalWorkspace>[0]) : owner as Parameters<typeof createLocalWorkspace>[0], score.choirId, score.id) : null;
  const offline = useOfflineScore(workspace);
  const preparation = useOfflinePreparation(workspace, score, props.userId ?? null, sessionId);
  const [opening, setOpening] = useState(false);
  const request = useRef(0);
  const lifetime = useRef(new AbortController());
  const target = JSON.stringify([workspace?.scopeKey, sessionId, score.currentVersion.id, canPrepare]);
  const [stateTarget, setStateTarget] = useState(target);
  if (stateTarget !== target) { setStateTarget(target); setOpening(false); }
  useEffect(() => { const controller = new AbortController(); lifetime.current = controller; return () => controller.abort(); }, [target]);
  const ready = offline?.scopeKey === workspace?.scopeKey && offline?.record && !offline.invalid;
  const go = (scrollY: number) => {
    openingGeneration++;
    props.onOpen(scrollY);
    void navigate(readerHref({ choirId: score.choirId, scoreId: score.id, experience: props.experience === true }));
  };
  const open = async () => {
    if (opening) return;
    const id = ++request.current;
    const generation = ++openingGeneration;
    const signal = lifetime.current.signal;
    const scrollY = window.scrollY;
    setOpening(true);
    const shell = "serviceWorker" in navigator ? await untilAborted(navigator.serviceWorker.getRegistration(), AbortSignal.any([signal, AbortSignal.timeout(1_000)])).catch(() => undefined) : undefined;
    if (signal.aborted || id !== request.current || generation !== openingGeneration) return;
    // Without an active offline shell, keep online reading available immediately.
    if (!shell?.active || !workspace) { setOpening(false); go(scrollY); return; }
    const result = await preparation.prepare();
    if (signal.aborted || id !== request.current || generation !== openingGeneration) { if (!signal.aborted && id === request.current) setOpening(false); return; }
    setOpening(false);
    if (result?.phase === "ready") go(scrollY);
  };
  return <div className="prepared-score-open">
    <div className="prepared-score-target" aria-busy={opening || undefined}>
      <ScoreLink {...props} onClick={event => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !canPrepare || props.local || ready) return;
        event.preventDefault();
        void open();
      }} onOpen={() => { openingGeneration++; props.onOpen(); }}>{props.children}</ScoreLink>
    </div>
  </div>;
}
