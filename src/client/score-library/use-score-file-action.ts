import { useMessages } from "../../i18n";
import { useRef } from "react";
import { scorePdfFileName } from "../../shared/score-display-name";
import type { ScoreSummary } from "../../shared/scores";
import { useSettingsMutation } from "../settings/settings-mutation";
import type { DriveLibrary } from "./drive-library";
import type { ScoreFileChange } from "./drive-library-transport";
import { uploadMessage } from "./library-format";

// Mount inside the user/session/drive/selection-keyed dialog. Write
// confirmation lives in the library so closing a dialog cannot bypass recovery.
export function useScoreFileAction(library: DriveLibrary, score: ScoreSummary, action: "rename" | "trash", onComplete: (message: string) => void, enabled = true) {
  const t = useMessages("library");
  const completed = useRef<ScoreFileChange | undefined>(undefined);
  const mutation = useSettingsMutation({
    enabled, paused: !enabled,
    initialRecovery: library.scoreChangeRecovery(score.id),
    refresh: async isCurrent => {
      const saved = await library.completeScoreChange(score.id);
      if (isCurrent()) completed.current = saved;
    },
  });
  const complete = (completedAction = action) => onComplete(completedAction === "rename" ? t("useScoreFileActionFileHasBeenRenamed") : t("useScoreFileActionFileHasBeenMoved"));

  const submit = async (name: string) => {
    const change: ScoreFileChange = action === "rename"
      ? { kind: "rename", scoreId: score.id, fileName: scorePdfFileName(name) }
      : { kind: "trash", scoreId: score.id };
    const saved = await mutation.submit(
      () => library.requestScoreChange(change),
      { rejectionMessage: (status, body) => status === 401 ? t("driveLibraryLoginHasExpiredLog") : status === 403 ? t("useScoreFileActionDoNotPermissionOperate") : uploadMessage(status, body) },
    );
    if (saved) complete();
  };

  const retry = async () => {
    if (!enabled) return;
    try {
      const reread = await mutation.refresh();
      // A successful recovery closes a confirmed action. An uncertain request
      // merely becomes editable again after the user has reread the directory.
      if (reread && completed.current) complete(completed.current.kind);
    } catch {
      // The submission module retains the original diagnosis and recovery gate.
    }
  };

  return { pending: mutation.pending, blocked: mutation.blocked, needsRefresh: mutation.needsRefresh, message: mutation.message, submit, retry };
}
