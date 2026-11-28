import { FeedbackMessage } from "../components/feedback-message";
import { useFeedbackMessage } from "../components/use-feedback-message";
import { useAppLocale, useMessages } from "../../i18n";
import { publishedQuestionStorageId } from "../platform/published-question-files";
import { readPublishedQuestionCopies } from "../sight-singing/published-question-cache";
import { createLocalWorkspace } from "../platform/local-workspace";
import { useOfflineScore } from "../offline/use-offline-score";
import { useApplicationIdentity } from "../auth/application-identity";
import { readAvailableOfflineSession } from "../auth/offline-session";
import { localDatabase } from "../platform/local-database";
import { scoreDisplayName } from "../../shared/score-display-name";
import { useParams } from "react-router-dom";
import { FileOpenLink } from "../score-library/file-open-link";
import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Button, Heading, Modal, ModalOverlay } from "react-aria-components";
import { TaskHeader } from "../components/task-header";
import { Dialog } from "../navigation/overlays";
import { clearLocalFiles, listLocalFiles, type LocalFileScope } from "../offline/local-files";
import { formatBytes } from "../score-library/library-format";

export default function LocalStoragePage() {
  const { locale } = useAppLocale();
  const t = useMessages("library");
  const { choirId = "" } = useParams();
  const identity = useApplicationIdentity();
  const directory = useLiveQuery(() => identity.localUserId ? localDatabase.driveDirectories.where("[ownerKey+choirId]").equals([`user:${identity.localUserId}`, choirId]).first() : undefined, [identity.localUserId, choirId]);
  const [revision, refresh] = useState(0);
  const files = useLiveQuery(() => listLocalFiles(locale).then(files => files.filter(file => file.choirId === choirId)).catch(() => null), [revision, choirId, locale]);
  const userId = identity.localUserId;
  const questions = useLiveQuery(async () => {
    if (!userId || identity.onlineState === "signed-out") return null;
    try {
      const session = await readAvailableOfflineSession(userId);
      if (!session) return null;
      const cached = await readPublishedQuestionCopies({ userId, choirId, sessionId: session.sessionId });
      return cached && { userId, choirId, copies: cached.copies };
    } catch { return null; }
  }, [userId, choirId, identity.onlineState, revision]);
  const questionFiles = directory && questions && questions.userId === userId && questions.choirId === choirId ? questions.copies.map(copy => ({
    key: copy.key, name: copy.question.title, size: copy.blob.size,
    scope: { ownerKey: directory.ownerKey, choirId, scoreId: publishedQuestionStorageId(copy.question.id) },
  })) : [];
  const [selection, setSelection] = useState<{ label: string; scopes: LocalFileScope[] } | null>(null);
  const [retrySelection, setRetrySelection] = useState<typeof selection>(null);
  const [busy, setBusy] = useState(false);
  const feedback = useFeedbackMessage();
  const { setMessage } = feedback;
  const totalBytes = (files?.reduce((sum, file) => sum + file.blob.size, 0) ?? 0) + questionFiles.reduce((sum, file) => sum + file.size, 0);
  const scopes = [...new Map(files?.map(file => [JSON.stringify([file.ownerKey, file.choirId, file.scoreId]), { ownerKey: file.ownerKey, choirId: file.choirId, scoreId: file.scoreId }])).values(),
    ...questionFiles.map(file => file.scope)];
  const clear = async () => {
    if (!selection || busy) return;
    setBusy(true);
    let bytes = 0;
    const failures: LocalFileScope[] = [];
    for (const scope of selection.scopes) {
      try { bytes += await clearLocalFiles(scope); } catch { failures.push(scope); }
    }
    setRetrySelection(failures.length ? { label: t("localStorageBeatsThatNotCleaned"), scopes: failures } : null);
    setMessage(failures.length ? t("localStorageCleanedItemsNotCompleted", { bytes: String(formatBytes(bytes)), length: String(failures.length) }) : t("localStorageCleanedNativeBeatFiles", { bytes: String(formatBytes(bytes)) }), failures.length ? undefined : { duration: 5000 });
    setBusy(false); setSelection(null);
  };
  return <div className="app-page"><TaskHeader title={t("localStorageLocalStorage")} backTo={`/choirs/${choirId}`} /><main className="page-shell settings-page settings-ux">
    <header className="settings-heading"><p>{t("localStorageDriveOnDevice", { name: files?.[0]?.driveName ?? directory?.choir.name ?? t("localStorageCurrentCloudDisk") })}</p></header>
    <p>{t("localStorageCleaningOnlyRemoveMusic")}</p>
    {files === null ? <p role="alert">{t("localStorageUnableReadLocalFile")}<Button onPress={() => refresh(value => value + 1)}>{t("retry")}</Button></p> : files === undefined ? <p role="status">{t("localStorageCountingLocalFiles")}</p> : <>
      {scopes.length === 0 && <p className="library-empty-state">{t("localStorageThereNoLocalMusic")}</p>}
      <p className="local-storage-summary">{formatBytes(totalBytes)} <small>{t("localStorageScoreCount", { count: new Set(scopes.map(file => file.scoreId)).size })}</small></p>
      {scopes.length > 0 && <Button className="secondary-button" onPress={() => setSelection({ label: t("localStorageAllLocalBeatFiles"), scopes })}>{t("localStorageCleanAllCapacity", { bytes: formatBytes(totalBytes) })}</Button>}
      <ul className="local-file-list">{files.map(file => <LocalFileRow key={file.key} file={file} currentVersionId={directory?.scores.find(score => score.id === file.scoreId)?.currentVersion.id} onClear={() => setSelection({ label: file.fileName, scopes: [{ ownerKey: file.ownerKey, choirId: file.choirId, scoreId: file.scoreId }] })} />)}
        {questionFiles.map(file => <li key={file.key} className="local-file-row">
          <div>{file.name}<p>{formatBytes(file.size)}</p></div>
          <Button className="text-button" onPress={() => setSelection({ label: file.name, scopes: [file.scope] })}
            aria-label={t("localStorageRemoveOfflineCopy", { name: file.name })}>{t("localStorageCleanup")}</Button>
        </li>)}
      </ul>
    </>}
    <FeedbackMessage feedback={feedback} />{retrySelection && <Button className="secondary-button" onPress={() => setSelection(retrySelection)}>{t("localStorageRetryingButNotCompleting")}</Button>}
    <ModalOverlay className="modal-overlay" isOpen={Boolean(selection)} onOpenChange={open => { if (!open && !busy) setSelection(null); }} isDismissable={!busy}><Modal className="app-modal"><Dialog className="app-dialog" exitDisabled={busy}>
      <Heading slot="title">{t("localStorageCleanUpLocalFiles")}</Heading><p>{t("localStorageOnlyCleanDownloadedPdfs")}</p><p>{selection && t("localStorageConfirmScope", { scope: selection.label })}</p>
      <Button className="secondary-button" isDisabled={busy} onPress={() => setSelection(null)}>{t("cancel")}</Button><Button className="primary-button" isDisabled={busy} onPress={() => void clear()}>{busy ? t("localStorageCleaningUp") : t("localStorageConfirmCleanup")}</Button>
    </Dialog></Modal></ModalOverlay>
  </main></div>;
}

function LocalFileRow({ file, currentVersionId, onClear }: { currentVersionId?: string; file: Awaited<ReturnType<typeof listLocalFiles>>[number]; onClear(): void }) {
  const t = useMessages("library");
  const workspace = createLocalWorkspace(file.ownerKey, file.choirId, file.scoreId);
  const offline = useOfflineScore(workspace);
  const status = !offline ? t("localStorageVerifying") : offline.readFailed ? t("localStorageVerificationFailedReopenTry") : offline.record?.key === file.key ? currentVersionId && file.versionId !== currentVersionId ? t("localStorageNeedsUpdateOldVersion") : t("localStorageAvailableOffline") : t("localStorageCopyNotAvailableNeeds");
  return <li className="local-file-row"><div><FileOpenLink to={`/choirs/${file.choirId}/scores/${file.scoreId}${file.ownerKey.startsWith("experience:") ? "?experience=1" : ""}`}>{scoreDisplayName(file.fileName)}</FileOpenLink>
    <p>{formatBytes(file.blob.size)} · {status}</p></div>
    <Button className="text-button" onPress={onClear} aria-label={t("localStorageRemoveOfflineCopy", { name: String(scoreDisplayName(file.fileName)) })}>{t("localStorageCleanup")}</Button></li>;
}
