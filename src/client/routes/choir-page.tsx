import { useReturnState } from "../navigation/navigation-context";
import { ConnectionHelp } from "../connection/connection-control";
import { useMessages } from "../../i18n";
import type { AttachmentRevealRequest } from "../score-library/attachments/use-attachment-reveal";
import { readerHref } from "../reader/reader-entry";
import { startPlayback } from "../playback/playback-store";
import { DrivePreparation } from "../score-library/drive-preparation";
import { useLibraryAttachmentPresentation } from "../score-library/attachments/use-library-attachment-presentation";
import { AttachmentEntry } from "../score-library/attachments/attachment-entry";
import { LibraryTaskLoading } from "../score-library/library-task-dialog";
import { AttachmentCount, AttachmentPending, AttachmentRows, type AttachmentSelection } from "../score-library/attachments/attachment-list";
import { InstallSuggestion } from "../install/install-entry";
import { scoreDisplayName } from "../../shared/score-display-name";
import { hasManagement, type Operation } from "../../shared/drive-permissions";
import { BackButton } from "../navigation/back-button";
import { PreparedScoreLink } from "../score-library/prepared-score-link";
import { useNetworkStatus } from "../platform/use-network-status";
import { rememberLastDrive, forgetLastDrive } from "../score-library/last-drive";
import { useApplicationIdentity } from "../auth/application-identity";
import { IdentityNotice } from "../auth/local-entry";
import type { ApplicationIdentity } from "../auth/application-identity";
import { FileMusic, LoaderCircle } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import {
  Button,
  Form,
  Input,
  Label,

  MenuItem,
  MenuTrigger,
  Popover,
  TextField,
} from "react-aria-components";
import { Menu } from "../navigation/overlays";
import { Link, useParams, useNavigate, useLocation } from "react-router-dom";

import type { ScoreSummary } from "../../shared/scores";
import { AppHeader } from "../components/app-header";
import {
  completeLoadingJourney,
  ensureLoadingJourney,
  isLoadingJourneyActive,
  startLoadingJourney,
} from "../performance/loading-performance";
import { rememberReaderScore } from "../reader/reader-score-cache";
import { classifyReaderOpen } from "../reader/reader-reopen-tracker";
import { scheduleReaderRuntimePreload } from "../reader/reader-runtime";
import { driveCacheOwnerKey, type DriveCacheOwnerKey } from "../score-library/drive-library-cache";
import { useDriveLibrary } from "../score-library/use-drive-library";
import {
  ScoreActionDialog,
  type ScoreAction,
  type ScoreActionSelection,
} from "../score-library/score-action-dialog";
import { formatBytes } from "../score-library/library-format";
import { UploadDialog } from "../score-library/upload-dialog";

import { DrivePage } from "../score-library/drive-page";
import { DriveHeader } from "../score-library/drive-header";
import { UploadFab } from "../score-library/upload-fab";
import type { LibrarySort, LibrarySortDirection } from "../score-library/library-view-state";
import { PullToRefresh } from "../score-library/pull-to-refresh";
import { OfflineScoreControl } from "../score-library/offline-score-control";


const LibraryExportDialog = lazy(() => import("../score-library/library-export-dialog").then(module => ({ default: module.LibraryExportDialog })));

export default function ChoirPage() {
  const { choirId = "" } = useParams();
  const identity = useApplicationIdentity();
  const cacheOwner = driveCacheOwnerKey(identity.localUserId, choirId);
  return <ChoirLibrary key={`${choirId}:${cacheOwner}`} choirId={choirId} identity={identity} cacheOwner={cacheOwner} />;
}

function ChoirLibrary({ choirId, identity, cacheOwner }: { choirId: string; identity: ApplicationIdentity; cacheOwner: DriveCacheOwnerKey }) {
  const [openedScoreId, setOpenedScoreId] = useReturnState<string | null>(`opened-score:${cacheOwner}:${choirId}`, null);
  const t = useMessages("library");
  const navigate = useNavigate(), location = useLocation();
  const { session } = identity;
  // A remembered session scopes the mounted view; only authenticatedUserId grants authority.
  const [dialogSession, setDialogSession] = useState(session.data?.session?.id ?? null);
  const presentationSessionId = identity.onlineState === "signed-out" ? null
    : identity.onlineState === "authenticated" ? identity.authenticatedSessionId
    : session.data?.session?.id ?? dialogSession;
  const userId = identity.localUserId ?? undefined;
  const online = useNetworkStatus();
  const { library, snapshot } = useDriveLibrary(cacheOwner, choirId, Boolean(identity.authenticatedUserId), !identity.restoring && (Boolean(userId) || identity.onlineState !== "checking"), presentationSessionId);
  const { access, view: { search }, scores: visibleScores, refreshMessage: searchMessage, joining: busy } = snapshot;
  const [openAdmissionDisplayName, setOpenAdmissionDisplayName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [quotaBlocked, setQuotaBlocked] = useState(false);
  const [exportScore, setExportScore] = useState<ScoreSummary | null>(null);
  const [attachmentSelection, setAttachmentSelection] = useState<(AttachmentSelection & { sessionId: string | null }) | null>(null);
  const selectAttachment = (selection: AttachmentSelection) => {
    if (selection.action === "open" && (selection.attachment?.kind === "musicxml" || selection.attachment?.kind === "audio")) {
      setAttachmentSelection(null);
      startPlayback({ attachment: selection.attachment, score: selection.score, choirId, ownerKey: cacheOwner, sessionId: identity.authenticatedSessionId, experience: "choir" in access && access.choir?.isPreviewEntry === true });
      if (selection.attachment.kind === "musicxml") void navigate(readerHref({ choirId, scoreId: selection.score.id, experience: "choir" in access && access.choir?.isPreviewEntry === true }, location.search));
    } else setAttachmentSelection({ ...selection, sessionId: identity.authenticatedSessionId });
  };
  const definitiveSession = identity.onlineState === "authenticated" || identity.onlineState === "signed-out" ? identity.authenticatedSessionId : undefined;
  const attachmentSessionCurrent = attachmentSelection && (definitiveSession === undefined || definitiveSession === attachmentSelection.sessionId);
  if (attachmentSelection && definitiveSession !== undefined && definitiveSession !== attachmentSelection.sessionId) setAttachmentSelection(null);
  const [attachmentGeneration, setAttachmentGeneration] = useState(0);
  const [expandedScoreIds, setExpandedScoreIds] = useState<Set<string>>(() => new Set());
  const [attachmentReveal, setAttachmentReveal] = useState<AttachmentRevealRequest>();
  const revealScope = `${choirId}:${cacheOwner}:${presentationSessionId}`;
  const finishAttachmentReveal = useCallback((request: AttachmentRevealRequest) => {
    setAttachmentReveal(current => current === request ? undefined : current);
  }, []);
  useEffect(() => {
    if (!attachmentReveal) return;
    const cancelAfterScroll = () => {
      if (Math.abs(window.scrollY - attachmentReveal.scrollY) >= 1) finishAttachmentReveal(attachmentReveal);
    };
    window.addEventListener("scroll", cancelAfterScroll, { passive: true });
    return () => window.removeEventListener("scroll", cancelAfterScroll);
  }, [attachmentReveal, finishAttachmentReveal]);
  const attachmentsEnabled = online && access.kind === "opened" && !access.local;
  const scoresWithAttachments = visibleScores.filter(score => (score.attachmentCount ?? 0) > 0);
  const attachments = useLibraryAttachmentPresentation(choirId, scoresWithAttachments, expandedScoreIds, attachmentsEnabled, `${cacheOwner}:${presentationSessionId ?? "guest"}:${attachmentGeneration}:${access.kind === "opened" && access.retained ? "revoked" : "accessible"}`, access.kind === "opened" && !access.retained ? cacheOwner : undefined);
  const [scoreAction, setScoreAction] = useState<ScoreActionSelection | null>(null);
  const refresh = () => {
    // Authentication changes cause useDriveLibrary to acquire/reload the now
    // authorized resource. Never grant authority from a refetch result here.
    if (identity.onlineState === "unreachable" || identity.onlineState === "local-unavailable" || identity.onlineState === "checking") return identity.session.refetch();
    attachments.retry();
    return library.refresh();
  };
  const refreshAfterMutation = library.changed;
  const updateSearch = (value: string) => {
    setAttachmentReveal(undefined);
    library.setSearch(value);
  };
  const updateSort = (value: LibrarySort) => {
    setAttachmentReveal(undefined);
    library.setSort(value);
  };

  const updateDirection = (value: LibrarySortDirection) => {
    setAttachmentReveal(undefined);
    library.setSortDirection(value);
  };

  const attachmentDialog = attachmentSelection && attachmentSessionCurrent && (access.kind === "loading" || (access.kind === "opened" && !access.retained)) && <AttachmentEntry
        key={`${attachmentSelection.sessionId ?? "guest"}:${attachmentSelection.score.id}:${attachmentSelection.attachment?.id ?? attachmentSelection.action}`}
        selection={attachmentSelection} choirId={choirId} ownerKey={cacheOwner} canModify={access.kind === "opened" && access.result.permissions.capabilities.operations.operations.includes("modifyFiles")} writable={attachmentsEnabled}
        onClose={() => setAttachmentSelection(null)} onChanged={async () => { setAttachmentGeneration(value => value + 1); await refreshAfterMutation(); }} />;

  // Reset private task selections only at a definitive boundary; temporary
  // connection checks keep the same mounted form and its unsaved input.
  const sessionChanged = dialogSession !== presentationSessionId;
  if (sessionChanged) setDialogSession(presentationSessionId);
  if (sessionChanged || identity.onlineState === "signed-out" || (access.kind === "opened" && access.retained)) {
    if (uploadOpen) setUploadOpen(false);
    if (scoreAction) setScoreAction(null);
    if (attachmentSelection) setAttachmentSelection(null);
  }

  useEffect(() => {
    if (!userId) return;
    if (access.kind === "opened" && !access.choir.isPreviewEntry && (access.isMember || access.rememberedMembership)) rememberLastDrive(userId, choirId);
    if (access.kind === "denied" || access.kind === "not-found" || (access.kind === "opened" && access.retained)) forgetLastDrive(userId, choirId);
  }, [access, userId, choirId]);

  useEffect(() => {
    if (!isLoadingJourneyActive("exit-score")) {
      ensureLoadingJourney("enter-drive", "direct");
    }
  }, []);

  useEffect(() => {
    if (access.kind !== "opened") return;
    const frame = window.requestAnimationFrame(() => {
      if (isLoadingJourneyActive("exit-score")) {
        completeLoadingJourney("exit-score", "drive-list-restored");
      } else {
        completeLoadingJourney("enter-drive", "drive-list-usable");
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [access]);

  useEffect(() => {
    if (access.kind !== "opened") return;
    return scheduleReaderRuntimePreload();
  }, [access.kind]);

  const openScoreAction = (score: ScoreSummary, action: ScoreAction) => {
    setScoreAction({ score, action });
    setMessage(null);
  };

  const headerActions = <Link className="header-action" to="/drives">{t("allDrives")}</Link>;

  if (access.kind === "join-required") {
    return (
      <div className="app-page">
        <ConnectionHelp />
        <AppHeader actions={headerActions} />
        <main className="page-shell compact-page access-page">
          <p className="eyebrow">{t("choirOpenAccess")}</p>
          <h1>{access.choir.name}</h1>
          <p className="hero__copy">{t("choirFillDisplayNameCloud")}</p>
          <Form className="entry-form" data-update-busy={openAdmissionDisplayName.trim() || busy ? "true" : undefined} onSubmit={(event) => { event.preventDefault(); void library.join(openAdmissionDisplayName); }}>
            <TextField
              isRequired
              value={openAdmissionDisplayName}
              onChange={setOpenAdmissionDisplayName}
              maxLength={40}
            >
              <Label>{t("displayName")}</Label>
              <Input autoComplete="nickname" placeholder={t("choirExampleXiaohua")} />
            </TextField>
            <Button type="submit" isDisabled={busy}>
              {busy ? t("choirJoining") : t("choirJoinEnter")}
            </Button>
          </Form>
          {snapshot.joinMessage ? <p role="alert">{snapshot.joinMessage}</p> : null}
        </main>
      </div>
    );
  }

  if (access.kind === "failed") {
    const reading = snapshot.reading.request === "pending";
    return <div className="app-page">
      <ConnectionHelp />
      <AppHeader actions={headerActions} />
      <main className="page-shell compact-page access-page">
        <h1>{t("driveOpenFailed")}</h1>
        <p role="alert">{snapshot.refreshMessage ?? t("driveLocalDirectoryUnreadable")}</p>
        <Button isDisabled={reading} onPress={() => void library.refresh()}>{t(reading ? "driveReading" : "driveRetryRead")}</Button>
      </main>
    </div>;
  }

  if (access.kind === "loading") {
    return (
      <><DrivePage choirId={choirId} choirName={access.choir?.name} header={<DriveHeader loading choirId={choirId} choirName={access.choir?.name ?? t("drive")} userId={userId} localOnly={!identity.authenticatedUserId} resolvingIdentity={identity.restoring || identity.onlineState === "checking"} search={search} onSearch={updateSearch} />} />{attachmentDialog}</>
    );
  }

  if (access.kind !== "opened") return null;
  const { choir, result } = access;
  const capabilities = result.permissions.capabilities;
  const visibleCapabilities = access.local ? access.rememberedCapabilities ?? capabilities : capabilities;
  const visible = (operation: Operation) => visibleCapabilities.operations.operations.includes(operation);
  const can = (operation: Operation) => capabilities.operations.operations.includes(operation);
  const managementVisible = hasManagement(capabilities) || access.managementVisible;
  const localFilesOnly = Boolean(access.local);
  const beforeScoreOpen = (score: ScoreSummary, scrollY = window.scrollY) => {
    setOpenedScoreId(score.id);
    startLoadingJourney("open-score", classifyReaderOpen(userId ?? "guest", choirId, score.id));
    library.prepareScoreOpen(scrollY);
    rememberReaderScore(userId ?? "guest", score);
  };
  const storageRatio = result.storage.usedBytes / result.storage.limitBytes;

  const connectionHelp = <div className="drive-connection-help">
    {!online && <p>{t("choirCurrentlyOfflineSavedScores")}</p>}
    <IdentityNotice identity={identity} />
    {searchMessage && <p>{searchMessage}<Button onPress={() => void refresh()}>{t("retry")}</Button></p>}
  </div>;

  return (
    <><DrivePage choirId={choirId} connectionHelp={connectionHelp} header={<DriveHeader choirId={choirId} choirName={choir.name} userId={userId} email={session.data?.user.email} localOnly={Boolean(access.local) || !online} canManageIdentity={access.isMember || access.rememberedMembership} search={search} onSearch={updateSearch} view={snapshot.view} onSort={updateSort} onDirection={updateDirection} />}>
      <PullToRefresh key={`${cacheOwner}:${choirId}`} onRefresh={async () => {
        await refresh();
        if (library.getSnapshot().refreshMessage) throw new Error("drive_refresh_failed");
      }} disabled={!online}>
      <main className="page-shell file-library">
        {access.retained && <p role="status">{t("choirCloudDiskCannotAccessed")}</p>}
        {choir.isPreviewEntry ? <InstallSuggestion /> : !identity.restoring && !access.retained &&
          !access.local && (identity.onlineState === "authenticated" || identity.onlineState === "signed-out") &&
          <DrivePreparation choirId={choirId} accountReady={Boolean(identity.authenticatedUserId) && access.isMember} />}
        <section className="library-workspace" aria-label={t("score")} aria-busy={snapshot.reading.request === "pending"}>
          {search.trim() && <p className="visually-hidden" role="status">{t(localFilesOnly ? "localScoreSearchResultCount" : "scoreSearchResultCount", { count: visibleScores.length })}</p>}

          {can("uploadFiles") && (storageRatio >= 0.8 || quotaBlocked) ? (
            <p className="storage-warning" role="status">{t("driveStorageUsage", { used: formatBytes(result.storage.usedBytes), limit: formatBytes(result.storage.limitBytes) })}{" "}
              {quotaBlocked ? t("choirFollowUploadPromptsFree") : t("choirCloseUpperLimitPay")}
            </p>
          ) : null}
          {message ? <p className="library-message" role="status">{message}</p> : null}

          {visibleScores.length > 0 ? (
            <section className="file-list" aria-label={t("choirPdfFile")}>
              {visibleScores.map((score) => {
                const presentation = attachments.forScore(score);
                return (
                <article className="score-file-group" data-returned-score={openedScoreId === score.id || undefined} key={score.id}><div className="file-row">
                  <PreparedScoreLink score={score} sessionId={identity.authenticatedSessionId} explainUnavailable={false} experience={choir.isPreviewEntry === true} label={scoreDisplayName(score.fileName)} description={t("choirFileSize", { fileSize: formatFileSize(score.currentVersion.sizeBytes) })} userId={userId} choirId={choirId} scoreId={score.id} local={localFilesOnly}
                    onOpen={scrollY => beforeScoreOpen(score, scrollY)}
                  >
                    {(opening, percent) => <>
                    <span className="pdf-file-icon" aria-hidden="true">{opening && percent === null ? <LoaderCircle size={18} className="prepared-score-spinner" /> : "PDF"}</span>
                    <span className="file-row__info"><span className="file-row__name" title={scoreDisplayName(score.fileName)}>{scoreDisplayName(score.fileName)}</span><span className="file-row__size">{opening ? t(percent !== null ? "scoreDownloading" : "scoreOpening") : formatFileSize(score.currentVersion.sizeBytes)}{presentation.hasGeneratedXml && <span className="file-row__practice" role="img" aria-label={t("choirThereAutomaticallyGeneratedPractice")} title={t("choirExerciseVersionHasBeen")}><FileMusic size={12} aria-hidden="true" /></span>}</span></span>
                  </>}
                  </PreparedScoreLink>
                  <AttachmentCount score={score} count={presentation.count} expanded={expandedScoreIds.has(score.id)} disabled={false}
                    onToggle={() => {
                      const expanding = !expandedScoreIds.has(score.id);
                      setAttachmentReveal(expanding ? { scoreId: score.id, scope: revealScope, scrollY: window.scrollY } : undefined);
                      setExpandedScoreIds(current => { const next = new Set(current); if (expanding) next.add(score.id); else next.delete(score.id); return next; });
                    }} />
                  <div className="file-row__offline"><OfflineScoreControl experience={choir.isPreviewEntry === true} score={score} authenticatedUserId={userId ?? null} authenticatedSessionId={identity.authenticatedSessionId} disabled={session.isPending || access.local} onOnlineOpen={() => {
                    beforeScoreOpen(score);
                    void navigate(readerHref({ choirId, scoreId: score.id, experience: choir.isPreviewEntry === true }));
                  }} /></div>
                  <MenuTrigger>
                      <Button className="file-menu-button" aria-label={t("choirMoreOperations", { name: String(scoreDisplayName(score.fileName)) })}>
                        ···
                      </Button>
                      <Popover className="file-menu-popover">
                        <Menu
                          aria-label={t("choirOperation", { name: String(scoreDisplayName(score.fileName)) })}
                          disabledKeys={!online || access.local ? ["rename", "replace", "trash", "attachment-add"] : []}
                          onAction={key => {
                            if (key === "export") setExportScore(score);
                            else if (key === "attachment-add") selectAttachment({ score, action: "add" });
                            else openScoreAction(score, key as ScoreAction);
                          }}
                        >
                          <MenuItem id="export">{t("sharePdf")}</MenuItem>
                          {visible("uploadFiles") && <MenuItem id="attachment-add">{t("addAttachment")}</MenuItem>}
                          {managementVisible && <>
                          {visible("modifyFiles") && <MenuItem id="rename">{t("rename")}</MenuItem>}
                          {visible("modifyFiles") && <MenuItem id="replace">{t("replacePdf")}</MenuItem>}
                          {visible("trashFiles") && <MenuItem id="trash">{t("moveToTrash")}</MenuItem>}
                          </>}
                        </Menu>
                      </Popover>
                    </MenuTrigger>
                </div>
                <div id={`score-attachments-${score.id}`} hidden={!expandedScoreIds.has(score.id)}>
                  {/* Ready empty rows must also finish the explicit reveal request. */}
                  {expandedScoreIds.has(score.id) && (presentation.count > 0 || attachments.statusFor(score.id) === "ready") && (attachments.statusFor(score.id) === "unavailable" ? <p className="attachment-pending attachment-help" role="status">{t("choirDeviceHasNotSaved")}</p>
                    : attachments.statusFor(score.id) !== "ready" ? <AttachmentPending count={presentation.count} failed={attachments.statusFor(score.id) === "error"} retry={attachments.retry} />
                    : <><AttachmentRows revealRequest={attachmentReveal?.scoreId === score.id && attachmentReveal.scope === revealScope ? attachmentReveal : undefined} onRevealHandled={finishAttachmentReveal} available={attachmentsEnabled} score={score} choirId={choirId} items={attachments.items} canModify={can("modifyFiles")} canTrash={can("trashFiles")} onSelect={selectAttachment} /></>)}
                </div>
                </article>
              );
              })}
            </section>
          ) : (
            <div className="library-empty-state">{access.retained && <BackButton className="secondary-link" to="/drives">{t("allDrives")}</BackButton>}{search.trim() ? <><p>{t("scoreSearchNoMatch", { search })}</p><Button className="secondary-button" onPress={() => updateSearch("")}>{t("choirClearSearch")}</Button></> : <><p>{access.retained ? t("choirThereNoReservedCopies") : access.local ? t("choirDirectoryMusicScoreCloud") : t("choirCloudDiskDoesNot")}</p><p>{can("uploadFiles") ? t("choirUploadFirstPdfStart") : access.isMember ? t("choirAfterMembersUploadPermission") : t("choirThereCurrentlyNoSheet")}</p>{can("uploadFiles") ? <Button className="secondary-button" onPress={() => setUploadOpen(true)}>{t("choirUploadFirstPdf")}</Button> : null}</>}</div>
          )}
        </section>
      </main>
      </PullToRefresh>

      {exportScore && <Suspense fallback={<LibraryTaskLoading title={t("sharePdf")} size="tall" onClose={() => setExportScore(null)} />}><LibraryExportDialog key={`${exportScore.id}:${userId}`} score={exportScore} authenticatedUserId={userId ?? null} onClose={() => setExportScore(null)} /></Suspense>}
      {visible("uploadFiles") && <UploadFab disabled={!online || Boolean(access.local)} onPress={() => setUploadOpen(true)} />}


      {userId && !access.retained && visible("uploadFiles") ? <UploadDialog writable={online && !access.local && can("uploadFiles")} storage={result.storage}
        key={`upload:${choirId}:${userId}:${presentationSessionId}`}
        choirId={choirId}
        isOpen={uploadOpen}
        onOpenChange={setUploadOpen}
        onComplete={refreshAfterMutation}
        onQuotaChange={setQuotaBlocked}
        onInspect={(fileName) => {
          updateSearch(fileName.trim());
          setMessage(t("choirCheckFileSameName"));
          void refreshAfterMutation();
        }}
      /> : null}
      {scoreAction && !access.retained && visible(scoreAction.action === "trash" ? "trashFiles" : "modifyFiles") ? (
        <ScoreActionDialog ownerUserId={userId} writable={online && !access.local && can(scoreAction.action === "trash" ? "trashFiles" : "modifyFiles")} library={library} canPurge={result.permissions.capabilities.isOwner}
          key={`${presentationSessionId}:${scoreAction.score.id}:${scoreAction.action}`}
          choirId={choirId}
          selection={scoreAction}
          onClose={() => setScoreAction(null)}
          onComplete={(nextMessage) => {
            setScoreAction(null);
            setMessage(nextMessage);
          }}
        />
      ) : null}
    </DrivePage>{attachmentDialog}</>
  );
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}
