import { ScoreDownloadProgress } from "./score-download-progress";
import { useAppLocale, useMessages } from "../../i18n";
import { useNetworkStatus } from "../platform/use-network-status";
import { offlinePreparationDescription } from "../offline/offline-score-status";
import { scoreDisplayName } from "../../shared/score-display-name";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useId, useRef, useState } from "react";
import { Button,  Heading, Popover, Tooltip, TooltipTrigger } from "react-aria-components";
import { Dialog } from "../navigation/overlays";
import { CircleAlert, HardDriveDownload, LoaderCircle, RefreshCw, HardDrive, Check } from "lucide-react";
import type { ScoreSummary } from "../../shared/scores";
import { ACTIVE_LOCAL_OWNER_KEY, guestOwnerSystemKey, localDatabase } from "../platform/local-database";
import { experienceOwnerKey, authenticatedLocalOwnerKey, createLocalWorkspace, resolveLocalWorkspace, type LocalWorkspaceOwnerKey } from "../platform/local-workspace";
import { useOfflineScore, useOfflinePreparation } from "../offline/use-offline-score";
import "./offline-score-control.css";

export function OfflineScoreControl({ score, authenticatedUserId, authenticatedSessionId, experience = false, disabled = false, onOnlineOpen }: {
  score: ScoreSummary; authenticatedUserId: string | null; authenticatedSessionId: string | null; disabled?: boolean; experience?: boolean; onOnlineOpen?: () => void;
}) {
  const { locale } = useAppLocale();
  const t = useMessages("library");
  const online = useNetworkStatus();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const detailsId = useId();
  const owner = useLiveQuery(async () => {
    try {
    const active = await localDatabase.system.get(ACTIVE_LOCAL_OWNER_KEY);
    if (authenticatedUserId) return active?.value === authenticatedLocalOwnerKey(authenticatedUserId) ? authenticatedLocalOwnerKey(authenticatedUserId) : null;
    if (active?.value.startsWith("user:")) return active.value as LocalWorkspaceOwnerKey;
    return (await localDatabase.system.get(guestOwnerSystemKey(score.choirId)))?.value as LocalWorkspaceOwnerKey | undefined ?? null;
    } catch { return null; }
  }, [authenticatedUserId, score.choirId]);
  useEffect(() => {
    if (owner !== null || disabled || authenticatedUserId) return;
    const controller = new AbortController();
    // A first-time guest has no owner until a workspace is established. The
    // live query observes its creation before downloads become available.
    void resolveLocalWorkspace({ authenticatedUserId: null, choirId: score.choirId, scoreId: score.id, signal: controller.signal }).catch(() => undefined);
    return () => controller.abort();
  }, [owner, disabled, authenticatedUserId, score.choirId, score.id]);
  const workspace = owner ? createLocalWorkspace(experience ? experienceOwnerKey(owner) : owner, score.choirId, score.id) : null;
  const [inspectionAttempt, setInspectionAttempt] = useState(0);
  const offline = useOfflineScore(workspace, inspectionAttempt);
  const { state: attempt, prepare } = useOfflinePreparation(workspace, score, authenticatedUserId, authenticatedSessionId);
  const phase = attempt.phase;
  const inspected = Boolean(workspace && offline?.scopeKey === workspace.scopeKey);
  const record = offline?.scopeKey === workspace?.scopeKey ? offline?.record ?? null : null;
  const invalid = offline?.scopeKey === workspace?.scopeKey && offline?.invalid;
  const readFailed = inspected && offline?.readFailed;
  const downloading = phase === "preparing";
  const explicitDownload = attempt.phase === "preparing" && attempt.intent === "explicit";
  const failed = phase === "failed";
  const stale = Boolean(record && record.versionId !== score.currentVersion.id);
  const needsDownload = !record || invalid || stale || failed;
  const state = downloading ? "downloading" : failed || invalid || readFailed ? "error" : stale ? "stale" : record ? "ready" : "missing";
  const percent = attempt.phase === "preparing" && attempt.stage === "download" && attempt.totalBytes
    ? Math.min(100, Math.floor((attempt.loadedBytes ?? 0) / attempt.totalBytes * 100)) : null;
  const description = percent !== null ? t("offlineScoreControlDownloading", { percent: String(percent) }) : offlinePreparationDescription(attempt, inspected ? { record, invalid: Boolean(invalid), readFailed } : null, score.currentVersion.id, locale);
  const actionLabel = failed ? t("offlineScoreControlRetrySaving") : stale ? t("offlineScoreControlUpdateOfflineCopy") : t("offlineScoreControlSaveOfflineUse");
  const Icon = state === "downloading" ? LoaderCircle : state === "error" ? CircleAlert : state === "stale" ? RefreshCw : state === "ready" ? HardDrive : HardDrive;

  return <div className="offline-score-control" data-state={state}>
    <TooltipTrigger delay={400}>
      <Button
        ref={triggerRef}
        className="offline-score-button"
        aria-label={t("offlineScoreControl", { name: String(scoreDisplayName(score.fileName)), description: String(description) })}
        aria-haspopup="dialog"
        aria-expanded={detailsOpen}
        aria-controls={detailsOpen ? detailsId : undefined}
        isDisabled={!workspace}
        onPress={() => {
          setDetailsOpen(true);
        }}
      >
        {downloading && percent !== null ? <ScoreDownloadProgress percent={percent} /> : <Icon aria-hidden="true" size={16} />}
        {state === "ready" && <Check className="offline-score-check" aria-hidden="true" size={9} />}
      </Button>
      <Tooltip className="offline-score-tooltip">{description}</Tooltip>
    </TooltipTrigger>
    <Popover triggerRef={triggerRef} isOpen={detailsOpen} onOpenChange={setDetailsOpen} placement="bottom end" className="offline-score-popover">
      <Dialog id={detailsId} className="offline-score-details">
        <Heading slot="title"><HardDriveDownload aria-hidden="true" size={18} />{t("offlineScoreControlOfflineCopy")}</Heading>
        <p role="status">{description}</p>
        <p>{t("offlineScoreControl2")}</p>
        {readFailed && <Button className="secondary-button" onPress={() => setInspectionAttempt(value => value + 1)}>{t("offlineScoreControlRetryVerification")}</Button>}
        {!readFailed && needsDownload && <Button className="secondary-button" isDisabled={!online || disabled || !workspace || explicitDownload} onPress={() => void prepare()}>{downloading ? explicitDownload ? t("libraryExportPreparing") : t("offlineScoreControlContinueSavingNoInterruption") : actionLabel}</Button>}
        {failed && online && !disabled && onOnlineOpen && <Button className="secondary-button" onPress={onOnlineOpen}>{t("offlineScoreControlOpenOnline")}</Button>}
        <Button className="text-button" onPress={() => setDetailsOpen(false)}>{t("close")}</Button>
      </Dialog>
    </Popover>
  </div>;
}
