import { attachmentListSchema, type ScoreAttachment } from "../../../shared/attachments";
import type { ScoreSummary } from "../../../shared/scores";
import { localDatabase, guestOwnerSystemKey } from "../../platform/local-database";
import { captureLocalWorkspaceSession, createLocalWorkspace, withLocalWorkspaceTransaction, type LocalWorkspace, type LocalWorkspaceOwnerKey } from "../../platform/local-workspace";
import { captureNavigationIdentity } from "../../settings/navigation-events";
import { SettingsRequestError } from "../../settings/settings-request";
import { attachmentFetch } from "./request";

const prefix = "attachment-directory";
const key = (workspace: LocalWorkspace) => JSON.stringify([prefix, workspace.ownerKey.replace(/^experience:/, ""), workspace.choirId, workspace.scoreId]);
const fenceKey = (workspace: LocalWorkspace) => JSON.stringify(["attachment-directory-fence", workspace.ownerKey.replace(/^experience:/, ""), workspace.choirId]);
export const attachmentRevision = (score: Pick<ScoreSummary, "id" | "updatedAt" | "attachmentCount">) => JSON.stringify([score.id, score.updatedAt, score.attachmentCount ?? 0]);
export function isAttachmentDirectoryKey(key: string, owner: string) {
  return key.startsWith(JSON.stringify([prefix, owner]).slice(0, -1));
}
export async function attachmentWorkspace(owner: string, choirId: string, scoreId: string) {
  const actual = owner.startsWith("user:") ? owner : (await localDatabase.system.get(guestOwnerSystemKey(choirId)))?.value;
  if (!actual) return null;
  return captureLocalWorkspaceSession(createLocalWorkspace(actual as LocalWorkspaceOwnerKey, choirId, scoreId));
}
export async function readAttachmentDirectory(workspace: LocalWorkspace, score: Pick<ScoreSummary, "id" | "updatedAt" | "attachmentCount">) {
  return withLocalWorkspaceTransaction(workspace, "r", [], async () => {
    const saved = await localDatabase.system.get(key(workspace));
    if (!saved) return null;
    try {
      const data = JSON.parse(saved.value);
      if (data.revision !== attachmentRevision(score)) return null;
      return attachmentListSchema.parse(data).attachments.filter(item => item.scoreId === score.id);
    } catch { return null; }
  });
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
  return async (score: Pick<ScoreSummary, "id" | "updatedAt" | "attachmentCount">, attachments: ScoreAttachment[], signal: AbortSignal) => {
    await withLocalWorkspaceTransaction(workspace, "rw", [], async () => {
      signal.throwIfAborted();
      if (!currentIdentity() || fence !== (await localDatabase.system.get(fenceKey(workspace)))?.value) return;
      await localDatabase.system.put({ key: key(workspace), value: JSON.stringify({ revision: attachmentRevision(score), attachments: attachments.filter(item => item.scoreId === score.id && !item.trashExpiresAt) }) });
    });
  };
}
// Only metadata is requested. Failure cannot change the score's offline readiness.
export async function prepareAttachmentDirectory(workspace: LocalWorkspace, score: ScoreSummary, parentSignal: AbortSignal) {
  const signal = AbortSignal.any([parentSignal, AbortSignal.timeout(5_000)]);
  const save = await captureAttachmentDirectoryWrite(workspace);
  const query = new URLSearchParams({ scoreIds: score.id });
  const response = await attachmentFetch(`/api/choirs/${encodeURIComponent(score.choirId)}/attachments?${query}`, { signal });
  signal.throwIfAborted();
  if (!response.ok) {
    if ([401, 403, 404].includes(response.status)) await clearAttachmentDirectories(workspace);
    throw new SettingsRequestError(response.status);
  }
  const { attachments } = attachmentListSchema.parse(await response.json());
  await save(score, attachments, signal);
}
