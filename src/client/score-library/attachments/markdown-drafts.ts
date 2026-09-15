import { z } from "zod";

const draftSchema = z.object({ id: z.uuid(), name: z.string(), text: z.string(), revision: z.number().int().positive().nullable() });
export type MarkdownDraft = z.infer<typeof draftSchema>;
export type MarkdownDraftScope = { ownerKey: string; choirId: string; scoreId: string };
export function markdownDraftKey(scope: MarkdownDraftScope, attachmentId: string | null) {
  return `same-page:attachment-draft:${JSON.stringify([scope.ownerKey, scope.choirId, scope.scoreId, attachmentId ?? "new"])}`;
}
function read(key: string) {
  const parsed = draftSchema.safeParse(JSON.parse(sessionStorage.getItem(key) ?? "null"));
  return parsed.success ? parsed.data : null;
}

export function readMarkdownDraft(scope: MarkdownDraftScope, attachmentId: string | null): MarkdownDraft | null {
  try {
    const newKey = markdownDraftKey(scope, null);
    const legacy = read(newKey);
    // Earlier previews kept post-save edits in the new-document slot. Move
    // them to their real document without replacing another recovered draft.
    if (legacy && legacy.revision !== null) {
      const savedKey = markdownDraftKey(scope, legacy.id);
      if (sessionStorage.getItem(savedKey) === null) {
        sessionStorage.setItem(savedKey, JSON.stringify(legacy));
        sessionStorage.removeItem(newKey);
      }
    }
    const draft = read(markdownDraftKey(scope, attachmentId));
    if (!draft) return null;
    return attachmentId ? (draft.id === attachmentId && draft.revision !== null ? draft : null)
      : (draft.revision === null ? draft : null);
  } catch { return null; /* Optional same-tab loss protection. */ }
}
