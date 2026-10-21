import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router-dom";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import { AttachmentEntry } from "./attachment-entry";
import { RouteContent } from "../../components/route-content";
import { NavigationProvider } from "../../navigation/navigation";
import { clearDiagnostics, exportDiagnostics } from "../../diagnostics/diagnostics";
import type { ScoreSummary } from "../../../shared/scores";

const score: ScoreSummary = { id: "score", choirId: "love", fileName: "舟中晓望.pdf", updatedAt: 1, currentVersion: { id: "v", versionNumber: 1, sizeBytes: 10, sha256: "a".repeat(64), etag: "v", pageCount: 1, createdAt: 1 } };
type Load = NonNullable<Parameters<typeof AttachmentEntry>[0]["load"]>;
function setup(load: Load) {
  function Drive() {
    const [open, setOpen] = useState(true);
    return <><h1>爱情</h1><p>当前云盘的文件</p>{open && <AttachmentEntry selection={{ action: "add", score }} choirId="love" ownerKey="user:one" writable canModify onClose={() => setOpen(false)} onChanged={async () => {}} load={load} />}</>;
  }
  const router = createMemoryRouter([{ element: <NavigationProvider><Outlet /></NavigationProvider>, children: [
    { path: "/choirs/old", element: <h1>旧云盘</h1> },
    { path: "/choirs/love", element: <RouteContent><Drive /></RouteContent> },
  ] }], { initialEntries: ["/choirs/old", "/choirs/love"], initialIndex: 1 });
  render(<RouterProvider router={router} />); return router;
}

it("opens all five type choices without loading an optional attachment module", async () => {
  const load = vi.fn<Load>(); setup(load);
  expect(screen.getByRole("dialog", { name: "添加附件" })).toBeInTheDocument();
  for (const name of ["可播放乐谱", "音频", "PDF", "文档（仅 .md）", "链接"]) expect(screen.getByRole("button", { name })).toBeInTheDocument();
  expect(load).not.toHaveBeenCalled();
});

it("contains a rejected module inside the attachment window and system Back closes it", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  clearDiagnostics();
  try {
    const router = setup(() => Promise.reject(new TypeError("private URL must never escape")));
    fireEvent.click(screen.getByRole("button", { name: "音频" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("附件暂时无法打开");
    expect(screen.getByRole("heading", { name: "爱情", hidden: true })).toBeInTheDocument();
    const diagnostics = exportDiagnostics();
    expect(diagnostics).toContain("attachment-entry"); expect(diagnostics).not.toContain("private URL");
    await act(() => router.navigate(-1));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(router.state.location.pathname).toBe("/choirs/love");
  } finally { error.mockRestore(); }
});

it("retries with a fresh lazy instance and returns from the recovered form to the picker", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const load = vi.fn<Load>().mockRejectedValueOnce(new TypeError("module unavailable"))
    .mockImplementation(() => import("./attachment-dialog"));
  try {
    setup(load);
    fireEvent.click(screen.getByRole("button", { name: "PDF" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "重试打开" }));
    expect(await screen.findByLabelText("选择附件文件")).toHaveAttribute("accept", ".pdf");
    expect(load).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "返回附件类型" }));
    expect(await screen.findByRole("dialog", { name: "添加附件" })).toBeInTheDocument();
  } finally { error.mockRestore(); }
});
