import { beforeEach, expect, it } from "vitest";
import { clearMarkdownDraftsAfterLogout, countMarkdownDrafts, markdownDraftEpoch, markdownDraftKey, readMarkdownDraft, writeMarkdownDraft } from "./markdown-drafts";

const scope = { ownerKey: "user:one", choirId: "drive", scoreId: "score" };
const id = "00000000-0000-4000-8000-000000000001";
const saved = { id, name: "笔记.md", text: "不要丢失的草稿", revision: 1 };
beforeEach(() => { sessionStorage.clear(); localStorage.clear(); });

it("moves a post-save legacy draft out of new-document creation", () => {
  sessionStorage.setItem(markdownDraftKey(scope, null), JSON.stringify(saved));
  expect(readMarkdownDraft(scope, null)).toBeNull();
  expect(readMarkdownDraft(scope, id)).toEqual(saved);
  expect(sessionStorage.getItem(markdownDraftKey(scope, null))).toBeNull();
});
it("recovers a legacy saved draft when the actual document is opened first", () => {
  sessionStorage.setItem(markdownDraftKey(scope, null), JSON.stringify(saved));
  expect(readMarkdownDraft(scope, id)).toEqual(saved);
});
it("does not overwrite an already recovered draft or leak one across owners", () => {
  sessionStorage.setItem(markdownDraftKey(scope, null), JSON.stringify(saved));
  const existing = { ...saved, text: "另一个更晚的草稿" };
  sessionStorage.setItem(markdownDraftKey(scope, id), JSON.stringify(existing));
  expect(readMarkdownDraft(scope, null)).toBeNull();
  expect(readMarkdownDraft(scope, id)).toEqual(existing);
  expect(JSON.parse(sessionStorage.getItem(markdownDraftKey(scope, null))!)).toEqual(saved);
  expect(readMarkdownDraft({ ...scope, ownerKey: "user:two" }, id)).toBeNull();
});
it("resumes a real new draft without assigning a saved revision", () => {
  const draft = { ...saved, revision: null };
  sessionStorage.setItem(markdownDraftKey(scope, null), JSON.stringify(draft));
  expect(readMarkdownDraft(scope, null)).toEqual(draft);
  expect(readMarkdownDraft(scope, id)).toBeNull();
});

it("clears the departing owner's drafts without discarding another owner's work", () => {
  const other = { ...scope, ownerKey: "user:other" };
  writeMarkdownDraft(scope, id, saved, markdownDraftEpoch(scope.ownerKey));
  writeMarkdownDraft(other, id, saved, markdownDraftEpoch(other.ownerKey));
  expect(countMarkdownDrafts(scope.ownerKey)).toBe(1);
  clearMarkdownDraftsAfterLogout(scope.ownerKey);
  expect(countMarkdownDrafts(scope.ownerKey)).toBe(0);
  expect(readMarkdownDraft(other, id)?.text).toBe(saved.text);
});

it("rejects drafts and late writes from a suspended tab after logout and a later login", () => {
  const epoch = markdownDraftEpoch(scope.ownerKey);
  writeMarkdownDraft(scope, id, saved, epoch);
  const oldTab = sessionStorage.getItem(markdownDraftKey(scope, id))!;
  clearMarkdownDraftsAfterLogout(scope.ownerKey);
  // Another tab owns its own sessionStorage and can miss live notifications.
  sessionStorage.setItem(markdownDraftKey(scope, id), oldTab);
  expect(readMarkdownDraft(scope, id)).toBeNull();
  expect(sessionStorage.getItem(markdownDraftKey(scope, id))).toBeNull();
  writeMarkdownDraft(scope, id, saved, epoch);
  expect(readMarkdownDraft(scope, id)).toBeNull();
  writeMarkdownDraft(scope, id, saved, markdownDraftEpoch(scope.ownerKey));
  expect(readMarkdownDraft(scope, id)?.text).toBe(saved.text);
});
