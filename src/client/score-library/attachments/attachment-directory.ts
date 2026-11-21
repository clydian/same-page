import { attachmentListSchema, type ScoreAttachment } from "../../../shared/attachments";
import type { ScoreSummary } from "../../../shared/scores";
import { localDatabase, guestOwnerSystemKey } from "../../platform/local-database";
import { captureLocalWorkspaceSession, createLocalWorkspace, withLocalWorkspaceTransaction, type LocalWorkspace, type LocalWorkspaceOwnerKey } from "../../platform/local-workspace";
import { captureNavigationIdentity } from "../../settings/navigation-events";
import { isSettingsReadDenied, SettingsRequestError } from "../../settings/settings-request";
import { attachmentFetch } from "./request";

type DirectoryScore = Pick<ScoreSummary, "id" | "updatedAt" | "attachmentCount">;

const prefix = "attachment-directory";
const key = (workspace: LocalWorkspace) => JSON.stringify([prefix, workspace.ownerKey.replace(/^experience:/, ""), workspace.choirId, workspace.scoreId]);
const fenceKey = (workspace: LocalWorkspace) => JSON.stringify(["attachment-directory-fence", workspace.ownerKey.replace(/^experience:/, ""), workspace.choirId]);
export const attachmentRevision = (score: DirectoryScore) => JSON.stringify([score.id, score.updatedAt, score.attachmentCount ?? 0]);
export function isAttachmentDirectoryKey(key: string, owner: string) {
  return key.startsWith(JSON.stringify([prefix, owner]).slice(0, -1));
}
export async function attachmentWorkspace(owner: string, choirId: string, scoreId: string) {
  const actual = owner.startsWith("user:") ? owner : (await localDatabase.system.get(guestOwnerSystemKey(choirId)))?.value;
  if (!actual) return null;
  return captureLocalWorkspaceSession(createLocalWorkspace(actual as LocalWorkspaceOwnerKey, choirId, scoreId));
}
export async function readAttachmentDirectory(workspace: LocalWorkspace, score: DirectoryScore, retained = false) {
  return withLocalWorkspaceTransaction(workspace, "r", [], async () => {
    const saved = await localDatabase.system.get(key(workspace));
    if (!saved) return null;
    try {
      const data = JSON.parse(saved.value);
      if (!retained && data.revision !== attachmentRevision(score)) return null;
      return attachmentListSchema.parse(data).attachments.filter(item => item.scoreId === score.id);
    } catch { return null; }
  });
}
export async function attachmentDirectoryFence(workspace: LocalWorkspace) {
  return (await localDatabase.system.get(fenceKey(workspace)))?.value;
}
export async function clearAttachmentDirectories(workspace: LocalWorkspace) {
  await withLocalWorkspaceTransaction(workspace, "rw", [], async () => {
    const start = JSON.stringify([prefix, workspace.ownerKey.replace(/^experience:/, ""), workspace.choirId]).slice(0, -1);
    await localDatabase.system.filter(row => row.key.startsWith(start)).delete();
    await localDatabase.system.put({ key: fenceKey(workspace), value: crypto.randomUUID() });
  });
}
export async function captureAttachmentDirectoryWrite(input: LocalWorkspace) {
  const workspace = await captureLocalWorkspaceSession(input);
  const currentIdentity = captureNavigationIdentity();
  const fence = await withLocalWorkspaceTransaction(workspace, "r", [], async () => (await localDatabase.system.get(fenceKey(workspace)))?.value);
  return async (score: DirectoryScore, attachments: ScoreAttachment[], signal: AbortSignal) => {
    await withLocalWorkspaceTransaction(workspace, "rw", [], async () => {
      signal.throwIfAborted();
      if (!currentIdentity() || fence !== (await localDatabase.system.get(fenceKey(workspace)))?.value) return;
      await localDatabase.system.put({ key: key(workspace), value: JSON.stringify({ revision: attachmentRevision(score), attachments: attachments.filter(item => item.scoreId === score.id && !item.trashExpiresAt) }) });
    });
  };
}
type DirectoryTarget = {
  score: DirectoryScore;
  workspace: LocalWorkspace | null;
  save: Awaited<ReturnType<typeof captureAttachmentDirectoryWrite>> | null;
};

// Both callers capture their local write fences before the cloud request.
// Only a definitive denial clears the retained directory for that drive.
async function refreshDirectories(choirId: string, targets: DirectoryTarget[], signal: AbortSignal, persistence: "required" | "best-effort") {
  const persist = (operation: Promise<void>) => persistence === "required" ? operation : operation.catch(() => undefined);
  const query = new URLSearchParams({ scoreIds: targets.map(({ score }) => score.id).join(",") });
  signal.throwIfAborted();
  const response = await attachmentFetch(`/api/choirs/${encodeURIComponent(choirId)}/attachments?${query}`, { signal });
  signal.throwIfAborted();
  if (!response.ok) {
    const error = new SettingsRequestError(response.status);
    if (isSettingsReadDenied(error)) await Promise.all(targets.map(({ workspace }) => workspace ? persist(clearAttachmentDirectories(workspace)) : undefined));
    throw error;
  }
  const { attachments } = attachmentListSchema.parse(await response.json());
  signal.throwIfAborted();
  await Promise.all(targets.map(({ score, save }) => save ? persist(save(score, attachments, signal)) : undefined));
  signal.throwIfAborted();
  return attachments;
}

// A live library batch still displays fresh results if local storage fails.
export async function refreshLibraryAttachmentDirectories(choirId: string, scores: DirectoryScore[], owner: string | undefined, signal: AbortSignal) {
  const targets = owner ? await Promise.all(scores.map(async score => {
    const workspace = await attachmentWorkspace(owner, choirId, score.id).catch(() => null);
    const save = workspace ? await captureAttachmentDirectoryWrite(workspace).catch(() => null) : null;
    return { score, workspace, save };
  })) : scores.map(score => ({ score, workspace: null, save: null }));
  return refreshDirectories(choirId, targets, signal, "best-effort");
}

// Only metadata is requested. Failure cannot change the score's offline readiness.
export async function prepareAttachmentDirectory(workspace: LocalWorkspace, score: ScoreSummary, parentSignal: AbortSignal) {
  const signal = AbortSignal.any([parentSignal, AbortSignal.timeout(5_000)]);
  const save = await captureAttachmentDirectoryWrite(workspace);
  await refreshDirectories(score.choirId, [{ score, workspace, save }], signal, "required");
}
