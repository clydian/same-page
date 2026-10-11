import { act, renderHook, waitFor, render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { resolveLocalWorkspace, activateAuthenticatedLocalOwner } from "../../platform/local-workspace";
import { localDatabase } from "../../platform/local-database";
import { captureAttachmentDirectoryWrite, prepareAttachmentDirectory, readAttachmentDirectory } from "./attachment-directory";
import { rememberDriveAccessRevoked } from "../local-drive-directory";
import { clearPrivateLocalDataAfterLogout } from "../../auth/logout-local-data";
import { useLibraryAttachments } from "./use-library-attachments";
import { AttachmentRows } from "./attachment-list";

const score = { id: "score", choirId: "drive", fileName: "排练.pdf", updatedAt: 1, attachmentCount: 1, currentVersion: { id: "v1", versionNumber: 1, sizeBytes: 100, sha256: "a".repeat(64), etag: "v1", pageCount: 1, createdAt: 1 } };
const audio = { id: "audio", scoreId: score.id, name: "示范.mp3", kind: "audio" as const, url: null, sizeBytes: 50000000, revision: 1, updatedAt: 1, trashExpiresAt: null };
beforeEach(async () => { await localDatabase.open(); });
const signal = () => new AbortController().signal;

it("prepares only metadata and restores the attachment list after remounting offline", async () => {
  const workspace = await resolveLocalWorkspace({ authenticatedUserId: "user", choirId: "drive", scoreId: "score" });
  const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ attachments: [audio] }));
  try {
    await prepareAttachmentDirectory(workspace, score, signal());
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0][0])).toContain("/attachments?scoreIds=score");
    expect(await localDatabase.offlineScores.count()).toBe(0);
    const first = renderHook(() => useLibraryAttachments("drive", [score], false, "offline", "user:user"));
    await waitFor(() => expect(first.result.current.items).toEqual([audio]));
    first.unmount();
    const reopened = renderHook(() => useLibraryAttachments("drive", [score], false, "restart", "user:user"));
    await waitFor(() => expect(reopened.result.current.statusFor(score.id)).toBe("ready"));
    expect(reopened.result.current.items).toEqual([audio]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  } finally { fetcher.mockRestore(); }
});

it("preserves metadata on transient failure, replaces it on success, and distinguishes empty from unknown", async () => {
  const workspace = await resolveLocalWorkspace({ authenticatedUserId: "user", choirId: "drive", scoreId: "score" });
  const save = await captureAttachmentDirectoryWrite(workspace);
  await save(score, [audio], signal());
  const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 503 }));
  try {
    await expect(prepareAttachmentDirectory(workspace, score, signal())).rejects.toThrow();
    expect(await readAttachmentDirectory(workspace, score)).toEqual([audio]);
    fetcher.mockResolvedValue(Response.json({ attachments: [] }));
    await prepareAttachmentDirectory(workspace, score, signal());
    expect(await readAttachmentDirectory(workspace, score)).toEqual([]);
    expect(await readAttachmentDirectory(workspace, { ...score, id: "unknown" })).toBeNull();
  } finally { fetcher.mockRestore(); }
});

it.each(["drive denial", "attachment denial", "owner switch", "logout"])("does not resurrect protected metadata after %s", async reason => {
  const workspace = await resolveLocalWorkspace({ authenticatedUserId: "user", choirId: "drive", scoreId: "score" });
  const save = await captureAttachmentDirectoryWrite(workspace);
  await save(score, [audio], signal());
  if (reason === "drive denial") await rememberDriveAccessRevoked(workspace, signal());
  if (reason === "attachment denial") {
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 403 }));
    try { await expect(prepareAttachmentDirectory(workspace, score, signal())).rejects.toThrow(); }
    finally { fetcher.mockRestore(); }
  }
  if (reason === "owner switch") { await activateAuthenticatedLocalOwner("other"); await activateAuthenticatedLocalOwner("user"); }
  if (reason === "logout") { await clearPrivateLocalDataAfterLogout(); await activateAuthenticatedLocalOwner("user"); }
  await act(async () => { await save(score, [audio], signal()).catch(() => undefined); });
  if (reason === "owner switch") {
    const other = await resolveLocalWorkspace({ authenticatedUserId: "other", choirId: "drive", scoreId: "score" });
    expect(await readAttachmentDirectory(other, score)).toBeNull();
  } else expect(await readAttachmentDirectory(workspace, score)).toBeNull();
});

it("keeps offline attachment rows quiet and gives feedback only after clicking", () => {
  const open = vi.fn();
  render(<AttachmentRows score={score} choirId="drive" items={[audio, { ...audio, id: "link", kind: "link", name: "参考网页", url: "https://example.test" }]} available={false} canModify={false} canTrash={false} onSelect={open} />);
  expect(screen.queryByText("连接网络后可打开此附件。")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "示范.mp3" }));
  expect(screen.getByRole("status")).toHaveTextContent("连接网络后可打开此附件。");
  fireEvent.click(screen.getByRole("link", { name: "参考网页" }));
  expect(screen.getAllByRole("status")).toHaveLength(1);
  expect(open).not.toHaveBeenCalled();
});
