import { useEffect, useState } from "react";
import type { ScoreSummary } from "../../shared/scores";
import { LibraryTaskDialog } from "./library-task-dialog";
import { LoadingStatus } from "../components/loading-status";
import { resolveLocalWorkspace, type LocalWorkspace } from "../platform/local-workspace";
import { ExportDialog } from "../reader/export-dialog";

type Props = { score: ScoreSummary; authenticatedUserId: string | null; onClose(): void };

export function LibraryExportDialog(props: Props) {
  const { score, authenticatedUserId } = props;
  return <LibraryExportDialogContent key={JSON.stringify([score.choirId, score.id, score.currentVersion.id, authenticatedUserId])} {...props} />;
}

function LibraryExportDialogContent({ score, authenticatedUserId, onClose }: Props) {
  const [workspace, setWorkspace] = useState<LocalWorkspace | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void resolveLocalWorkspace({ authenticatedUserId, choirId: score.choirId, scoreId: score.id, signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setWorkspace(value); })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [authenticatedUserId, score.choirId, score.id]);
  if (workspace) return <ExportDialog workspace={workspace} versionId={score.currentVersion.id} fileName={score.fileName} authenticatedUserId={authenticatedUserId} onClose={onClose} />;
  return <LibraryTaskDialog title="分享 PDF" size="tall" onClose={onClose}>{failed ? <p role="alert">请确认登录身份后重新分享。</p> : <LoadingStatus>正在准备…</LoadingStatus>}</LibraryTaskDialog>;
}
