import type { ScoreSummary } from "../../shared/scores";
import { localDatabase, type OfflineScoreFile } from "../platform/local-database";
import { assertLocalWorkspaceActive, createLocalWorkspace, type LocalWorkspace } from "../platform/local-workspace";

export function offlineScoreSummary(record: OfflineScoreFile): ScoreSummary {
  return { id: record.scoreId, choirId: record.choirId, fileName: record.fileName, updatedAt: record.verifiedAt, currentVersion: { id: record.versionId, versionNumber: 1, sizeBytes: record.blob.size, sha256: record.sha256, etag: "offline", pageCount: record.pageCount, createdAt: record.verifiedAt } };
}

// Saved navigation is not a certificate that bytes or note permissions are valid.
// Like LocalLibrary, list owner-fenced metadata without rereading every PDF.
// Opening and the offline badge still verify current bytes and snapshots.
export async function readRetainedScores(workspace: LocalWorkspace): Promise<ScoreSummary[]> {
  await assertLocalWorkspaceActive(workspace);
  const files = await localDatabase.offlineScores.where("ownerKey")
    .equals(workspace.ownerKey).filter(file => file.choirId === workspace.choirId && file.active === 1).toArray();
  await assertLocalWorkspaceActive(workspace);
  const summaries = files.filter(file => file.scopeKey === createLocalWorkspace(workspace.ownerKey, workspace.choirId, file.scoreId).scopeKey
    && file.blob instanceof Blob && file.blob.size > 0 && file.verifiedAt > 0).map(offlineScoreSummary);
  return [...new Map(summaries.map(score => [score.id, score])).values()];
}
