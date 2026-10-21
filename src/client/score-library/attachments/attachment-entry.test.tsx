import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router-dom";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import { AttachmentEntry } from "./attachment-entry";
import { RouteContent } from "../../components/route-content";
import { NavigationProvider } from "../../navigation/navigation";
import { clearDiagnostics, exportDiagnostics } from "../../diagnostics/diagnostics";
import type { ScoreSummary } from "../../../shared/scores";

vi.mock("./pdf-preview", () => { throw new TypeError("private module URL must not escape"); });
const score: ScoreSummary = { id: "score", choirId: "love", fileName: "舟中晓望.pdf", updatedAt: 1, currentVersion: { id: "v", versionNumber: 1, sizeBytes: 10, sha256: "a".repeat(64), etag: "v", pageCount: 1, createdAt: 1 } };
function setup(preview = false) {
  function Drive() {
    const [open, setOpen] = useState(true);
    return <><h1>爱情</h1>{open && <AttachmentEntry selection={preview ? { action: "open", score, attachment: { id: "pdf", scoreId: "score", name: "歌词.pdf", kind: "pdf", url: null, sizeBytes: 10, revision: 1, updatedAt: 1, trashExpiresAt: null } } : { action: "add", score }} choirId="love" ownerKey="user:one" writable canModify onClose={() => setOpen(false)} onChanged={async () => {}} />}</>;
  }
  const router = createMemoryRouter([{ element: <NavigationProvider><Outlet /></NavigationProvider>, children: [
    { path: "/choirs/old", element: <h1>旧云盘</h1> },
    { path: "/choirs/love", element: <RouteContent><Drive /></RouteContent> },
  ] }], { initialEntries: ["/choirs/old", "/choirs/love"], initialIndex: 1 });
  render(<RouterProvider router={router} />); return router;
}
it("opens all five choices and the base PDF upload form without optional module imports", async () => {
  setup();
  for (const name of ["可播放乐谱", "音频", "PDF", "文档（仅 .md）", "链接"]) expect(screen.getByRole("button", { name })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "PDF" }));
  expect(screen.getByLabelText("选择附件文件")).toHaveAttribute("accept", ".pdf");
  fireEvent.click(screen.getByRole("button", { name: "返回附件类型" }));
  expect(await screen.findByRole("dialog", { name: "添加附件" })).toBeInTheDocument();
});
it("contains an optional preview module failure and system Back closes only the attachment", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  clearDiagnostics();
  try {
    const router = setup(true);
    expect(await screen.findByRole("alert")).toHaveTextContent("附件暂时无法打开");
    expect(screen.getByRole("link", { name: "检查更新" })).toHaveAttribute("href", "/about");
    expect(screen.getByRole("heading", { name: "爱情", hidden: true })).toBeInTheDocument();
    const diagnostics = exportDiagnostics();
    expect(diagnostics).toContain("attachment-entry"); expect(diagnostics).not.toContain("private module URL");
    await act(() => router.navigate(-1));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(router.state.location.pathname).toBe("/choirs/love");
  } finally { error.mockRestore(); }
});
