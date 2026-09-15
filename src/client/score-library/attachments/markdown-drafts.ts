import { z } from "zod";

const draftSchema = z.object({ id: z.uuid(), name: z.string(), text: z.string(), revision: z.number().int().positive().nullable(), logoutEpoch: z.string().optional() });
export type MarkdownDraft = z.infer<typeof draftSchema>;
export type MarkdownDraftScope = { ownerKey: string; choirId: string; scoreId: string };
const prefix = "same-page:attachment-draft:";
const epochPrefix = "same-page:attachment-draft-logout:";
export function markdownDraftKey(scope: MarkdownDraftScope, attachmentId: string | null) {
  return `${prefix}${JSON.stringify([scope.ownerKey, scope.choirId, scope.scoreId, attachmentId ?? "new"])}`;
}
export function markdownDraftEpoch(ownerKey: string) {
  try { return localStorage.getItem(epochPrefix + ownerKey) ?? ""; }
  catch { return null; }
}
function read(key: string, ownerKey: string) {
  const parsed = draftSchema.safeParse(JSON.parse(sessionStorage.getItem(key) ?? "null"));
  if (!parsed.success) return null;
  const epoch = markdownDraftEpoch(ownerKey);
  if (epoch === null) return null;
  if ((parsed.data.logoutEpoch ?? "") !== epoch) { sessionStorage.removeItem(key); return null; }
  return parsed.data;
}

export function writeMarkdownDraft(scope: MarkdownDraftScope, attachmentId: string | null, draft: MarkdownDraft, epoch: string | null) {
  const key = markdownDraftKey(scope, attachmentId);
  try {
    // A suspended editor cannot recreate a draft after logout in another tab.
    const currentEpoch = markdownDraftEpoch(scope.ownerKey);
    if (epoch === null || currentEpoch === null) return;
    if (epoch !== currentEpoch) return;
    sessionStorage.setItem(key, JSON.stringify({ ...draft, logoutEpoch: epoch }));
  } catch { /* Navigation and beforeunload guards remain available. */ }
}

export function removeMarkdownDraft(scope: MarkdownDraftScope, attachmentId: string | null, epoch: string | null) {
  try {
    if (epoch === null || epoch !== markdownDraftEpoch(scope.ownerKey)) return;
    sessionStorage.removeItem(markdownDraftKey(scope, attachmentId));
  } catch { /* An unreadable store is not permission to discard a draft. */ }
}

function ownerDraftKeys(ownerKey: string) {
  const ownedPrefix = prefix + JSON.stringify([ownerKey]).slice(0, -1) + ",";
  return Object.keys(sessionStorage).filter(key => key.startsWith(ownedPrefix));
}
export function countMarkdownDrafts(ownerKey: string) {
  try { return ownerDraftKeys(ownerKey).filter(key => read(key, ownerKey)).length; }
  catch { return 0; }
}
export function clearMarkdownDraftsAfterLogout(ownerKey: string) {
  // Keep this tombstone across future logins so even frozen tabs reject old
  // drafts. Failure propagates to the existing logout cleanup/retry flow.
  localStorage.setItem(epochPrefix + ownerKey, crypto.randomUUID());
  for (const key of ownerDraftKeys(ownerKey)) sessionStorage.removeItem(key);
}
export function observeMarkdownDraftLogout() {
  const removeStale = () => {
    try {
      for (const key of Object.keys(sessionStorage).filter(key => key.startsWith(prefix))) {
        const owner: unknown = JSON.parse(key.slice(prefix.length))?.[0];
        if (typeof owner === "string") read(key, owner);
      }
    } catch { /* Optional storage may be unavailable. */ }
  };
  const changed = (event: StorageEvent) => { if (event.storageArea === localStorage && event.key?.startsWith(epochPrefix)) removeStale(); };
  removeStale();
  window.addEventListener("storage", changed);
  return () => window.removeEventListener("storage", changed);
}

export function readMarkdownDraft(scope: MarkdownDraftScope, attachmentId: string | null): MarkdownDraft | null {
  try {
    const newKey = markdownDraftKey(scope, null);
    const legacy = read(newKey, scope.ownerKey);
    // Earlier previews kept post-save edits in the new-document slot. Move
    // them to their real document without replacing another recovered draft.
    if (legacy && legacy.revision !== null) {
      const savedKey = markdownDraftKey(scope, legacy.id);
      if (sessionStorage.getItem(savedKey) === null) {
        sessionStorage.setItem(savedKey, JSON.stringify(legacy));
        sessionStorage.removeItem(newKey);
      }
    }
    const draft = read(markdownDraftKey(scope, attachmentId), scope.ownerKey);
    if (!draft) return null;
    return attachmentId ? (draft.id === attachmentId && draft.revision !== null ? draft : null)
      : (draft.revision === null ? draft : null);
  } catch { return null; /* Optional same-tab loss protection. */ }
}
