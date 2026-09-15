import { beforeEach, expect, it } from "vitest";
import { markdownDraftKey, readMarkdownDraft } from "./markdown-drafts";

const scope = { ownerKey: "user:one", choirId: "drive", scoreId: "score" };
const id = "00000000-0000-4000-8000-000000000001";
const saved = { id, name: "笔记.md", text: "不要丢失的草稿", revision: 1 };
beforeEach(() => { sessionStorage.clear(); });

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
