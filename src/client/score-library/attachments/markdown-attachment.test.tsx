import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { ScoreAttachment } from "../../../shared/attachments";
import type { ScoreSummary } from "../../../shared/scores";
import { diagnosticFetch } from "../../diagnostics/diagnostics";
import MarkdownAttachment from "./markdown-attachment";
import { markdownDraftEpoch, markdownDraftKey, readMarkdownDraft, writeMarkdownDraft } from "./markdown-drafts";

vi.mock("../../diagnostics/diagnostics", () => ({ diagnosticFetch: vi.fn() }));

it("does not clear a saved draft when opening cloud content while the logout store is unavailable", async () => {
  localStorage.clear(); sessionStorage.clear();
  const scope = { ownerKey: "user:one", choirId: crypto.randomUUID(), scoreId: crypto.randomUUID() };
  const attachment: ScoreAttachment = { id: crypto.randomUUID(), scoreId: scope.scoreId, kind: "markdown", name: "笔记.md", url: null, sizeBytes: 20, revision: 1, updatedAt: 1, trashExpiresAt: null };
  const score: ScoreSummary = { id: scope.scoreId, choirId: scope.choirId, fileName: "主谱.pdf", updatedAt: 1, currentVersion: { id: crypto.randomUUID(), versionNumber: 1, sizeBytes: 100, sha256: "a".repeat(64), etag: "etag", pageCount: 1, createdAt: 1 } };
  writeMarkdownDraft(scope, attachment.id, { id: attachment.id, name: attachment.name, text: "尚未保存的原始草稿", revision: 1 }, markdownDraftEpoch(scope.ownerKey));
  const key = markdownDraftKey(scope, attachment.id), bytes = sessionStorage.getItem(key);
  vi.mocked(diagnosticFetch).mockImplementation(async input => String(input).includes("/file?") ? new Response("云端正文") : Response.json({ attachment }));
  const originalGet = Storage.prototype.getItem;
  const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, key) {
    if (this === localStorage) throw new DOMException("Blocked", "SecurityError");
    return originalGet.call(this, key);
  });
  try {
    const view = render(<MarkdownAttachment selection={{ action: "open", score, attachment }} choirId={scope.choirId} ownerKey={scope.ownerKey} canModify={false} writable onClose={() => {}} onChanged={async () => {}} />);
    expect(await screen.findByText("云端正文")).toBeInTheDocument();
    expect(sessionStorage.getItem(key)).toBe(bytes);
    view.unmount();
  } finally { get.mockRestore(); }
  expect(readMarkdownDraft(scope, attachment.id)?.text).toBe("尚未保存的原始草稿");
});
