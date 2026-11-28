import { FeedbackMessage } from "../components/feedback-message";
import { useFeedbackMessage } from "../components/use-feedback-message";
import { useMessages } from "../../i18n";
import { invalidateSettingsLifetime } from "../settings/use-settings-lifetime";
import { SettingsRequestError, isSettingsReadDenied } from "../settings/settings-request";
import { settingsError } from "../settings/settings-error";
import { PurgeDialog } from "../drives/purge-dialog";
import { ReplacedPdfTrash } from "./replaced-pdf-trash";
import { AttachmentTrash } from "./attachments/attachment-trash";
import { scoreDisplayName, scorePdfFileName } from "../../shared/score-display-name";
import { diagnosticFetch } from "../diagnostics/diagnostics";
import { type FormEvent, useEffect, useState } from "react";
import {
  Button,

  Form,
  Input,
  Label,
  TextField,
} from "react-aria-components";

import {
  scoreTrashResponseSchema,
  type TrashedScoreSummary,
} from "../../shared/scores";
import { uploadMessage } from "./library-format";
import { useTrashRestore } from "./use-trash-restore";

export function TrashContents({
  userId,
  choirId,
  canPurge = false,
  writable = true,
  onRestored,
}: {
  userId: string;
  choirId: string;
  canPurge?: boolean;
  writable?: boolean;
  onRestored: () => void | Promise<void>;
}) {
  const t = useMessages("library");
  const { lifetime, busy, attempt, reread, runRestore } = useTrashRestore(writable);
  const [purging, setPurging] = useState<TrashedScoreSummary | null>(null);
  const [trash, setTrash] = useState<TrashedScoreSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const feedback = useFeedbackMessage();
  const { message, setMessage } = feedback;
  const [restoreConflict, setRestoreConflict] = useState<TrashedScoreSummary | null>(null);
  const [restoreName, setRestoreName] = useState("");

  useEffect(() => {
    if (!writable) return;
    let active = true;
    void diagnosticFetch(`/api/choirs/${choirId}/scores/trash`)
      .then(async (response) => {
        if (!response.ok) throw new SettingsRequestError(response.status);
        const scores = scoreTrashResponseSchema.parse(await response.json()).scores;
        if (active) { setTrash(scores); setLoading(false); }
      })
      .catch(error => {
        if (active) {
          if (isSettingsReadDenied(error)) {
            invalidateSettingsLifetime(lifetime); setTrash([]); setRestoreConflict(null); setRestoreName(""); setPurging(null); }
          setMessage(settingsError(error, t("trashContentsRecycleBinCannotOpened"))); setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [choirId, attempt, writable, lifetime, setMessage, t]);

  if (purging && !writable) setPurging(null);

  const restoreScore = (score: TrashedScoreSummary, nextName?: string) => {
    let confirmed = false;
    return runRestore(async current => {
      setMessage(null);
      if (nextName) {
        const rename = await diagnosticFetch(`/api/choirs/${choirId}/scores/${score.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ fileName: scorePdfFileName(nextName) }),
        });
        if (!current()) return;
        if (!rename.ok) {
          const payload = await rename.json().catch(() => null);
          if (!current()) return;
          setMessage(uploadMessage(rename.status, payload));
          return;
        }
      }
      const response = await diagnosticFetch(`/api/choirs/${choirId}/scores/${score.id}/restore`, {
        method: "POST",
      });
      if (!current()) return;
      if (response.status === 409) {
        const payload = await response.json().catch(() => null);
        if (!current()) return;
        if (payload?.error !== "filename_conflict") { setMessage(uploadMessage(response.status, payload)); return; }
        setRestoreConflict(score);
        setRestoreName(scoreDisplayName(score.fileName));
        setMessage(t("trashContents"));
        return;
      }
      if (response.status === 404) {
        setRestoreConflict(null);
        setTrash((current) => current.filter((entry) => entry.id !== score.id));
        setMessage(t("trashContentsRefreshCloudDisk"));
        return;
      }
      if (!response.ok) throw new Error("restore_failed");
      setRestoreConflict(null);
      setTrash((current) => current.filter((entry) => entry.id !== score.id));
      confirmed = true;
      await onRestored();
      if (current()) setMessage(t("trashContents2"), { duration: 5000 });
    }, () => setMessage(confirmed ? t("trashRestoreRefreshFailed") : t("trashContentsRestoreNotCompletedTry")));
  };

  const submitConflict = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (restoreConflict) void restoreScore(restoreConflict, restoreName);
  };

  return (
    <section aria-label={t("trashContentsRecycleBinFiles")}>
              <p className="dialog-copy">{t("trashContents3")}</p>
              {loading ? <p role="status">{t("trashContentsReadingRecycleBin")}</p> : trash.length > 0 ? (
                <ul className="trash-list">
                  {trash.map((score) => (
                    <li key={score.id}>
                      <span>
                        <strong>{scoreDisplayName(score.fileName)}</strong>
                        <small>{t("trashExpiresAfter", { days: daysRemaining(score.trashExpiresAt) })}</small>
                      </span>
                      <Button isDisabled={busy || !writable} onPress={() => void restoreScore(score)}>{t("membershipManagementRecoveryMembership")}</Button>
                      {canPurge && <Button className="primary-button destructive-button" isDisabled={busy || !writable} onPress={() => setPurging(score)}>{t("replacedPdfTrashCompletelyDeleted")}</Button>}
                    </li>
                  ))}
                </ul>
              ) : (
                message && !feedback.temporary ? <Button isDisabled={!writable} onPress={() => { setMessage(null); setLoading(true); reread(); }}>{t("trashContentsReReadRecycleBin")}</Button> : <p className="dialog-copy">{t("trashContentsThereNoDeletedScores")}</p>
              )}
              {purging && writable && <PurgeDialog userId={userId} path={`/api/choirs/${choirId}/scores/${purging.id}/purge`} title={t("trashContentsCompletelyDeleteScore")} description={t("trashContentsPdfFilesAttachmentsNotes", { name: String(scoreDisplayName(purging.fileName)) })} onClose={() => setPurging(null)} onComplete={async () => { setTrash(current => current.filter(score => score.id !== purging.id)); setPurging(null); await onRestored(); }} />}
              <ReplacedPdfTrash key={`pdf:${userId}:${choirId}`} userId={userId} choirId={choirId} canPurge={canPurge} writable={writable} onRestored={onRestored} />
              <AttachmentTrash writable={writable} key={`${userId}:${choirId}`} choirId={choirId} onRestored={onRestored} />
              {restoreConflict ? (
                <Form className="entry-form restore-conflict" onSubmit={submitConflict}>
                  <TextField isRequired value={restoreName} onChange={setRestoreName} maxLength={255}>
                    <Label>{t("trashContentsNewFileNameUse")}</Label>
                    <Input autoFocus />
                  </TextField>
                  <Button type="submit" isDisabled={busy || !writable}>{t("trashContentsRenameRestore")}</Button>
                </Form>
              ) : null}
              <FeedbackMessage feedback={feedback} className="form-message" />
    </section>
  );
}

function daysRemaining(expiresAt: number) {
  return Math.max(1, Math.ceil((expiresAt - Date.now()) / (24 * 60 * 60 * 1000)));
}
