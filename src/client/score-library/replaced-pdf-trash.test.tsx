import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ReplacedPdfTrash } from "./replaced-pdf-trash";
const file = { id: "old", scoreId: "score", fileName: "排练.pdf", sizeBytes: 100, pageCount: 2, replacedAt: 123, trashExpiresAt: Date.now() + 86400000 };
afterEach(() => vi.unstubAllGlobals());
it("restores an old PDF with a new name and leaves the current score alone", async () => {
  const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => init?.method === "POST" ? Response.json({ scoreId: "restored" }) : Response.json({ files: [file] }));
  vi.stubGlobal("fetch", fetch);
  const complete = vi.fn();
  render(<ReplacedPdfTrash userId="user" choirId="drive" onRestored={complete} />);
  fireEvent.click(await screen.findByRole("button", { name: "恢复" }));
  expect(screen.getByLabelText("恢复后的文件名")).toHaveValue("排练（恢复）");
  fireEvent.click(screen.getByRole("button", { name: "恢复为独立乐谱" }));
  await waitFor(() => expect(complete).toHaveBeenCalledOnce());
  expect(fetch).toHaveBeenCalledWith("/api/choirs/drive/pdf-trash/old/restore", expect.objectContaining({
    body: JSON.stringify({ fileName: "排练（恢复）.pdf", expectedReplacedAt: 123 }),
  }));
  expect(screen.queryByText("排练")).not.toBeInTheDocument();
});
it("preserves the recovery name on filename conflict", async () => {
  vi.stubGlobal("fetch", vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => init?.method === "POST"
    ? Response.json({ error: "filename_conflict" }, { status: 409 }) : Response.json({ files: [file] })));
  render(<ReplacedPdfTrash userId="user" choirId="drive" onRestored={() => {}} />);
  fireEvent.click(await screen.findByRole("button", { name: "恢复" }));
  fireEvent.change(screen.getByLabelText("恢复后的文件名"), { target: { value: "重复名称" } });
  fireEvent.click(screen.getByRole("button", { name: "恢复为独立乐谱" }));
  await screen.findByText(/文件库已有同名文件/);
  expect(screen.getByLabelText("恢复后的文件名")).toHaveValue("重复名称");
});
it("fences a delayed restoration after authority loss and drops denied rows", async () => {
  let denied = false;
  let finish!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") return new Promise<Response>(resolve => { finish = resolve; });
    return denied ? new Response(null, { status: 403 }) : Response.json({ files: [file] });
  }));
  const complete = vi.fn();
  const props = { userId: "user", choirId: "drive", onRestored: complete };
  const view = render(<ReplacedPdfTrash {...props} />);
  fireEvent.click(await screen.findByRole("button", { name: "恢复" }));
  fireEvent.click(screen.getByRole("button", { name: "恢复为独立乐谱" }));
  view.rerender(<ReplacedPdfTrash {...props} writable={false} />);
  denied = true;
  view.rerender(<ReplacedPdfTrash {...props} />);
  await screen.findByText(/你没有操作此设置的权限/);
  await act(async () => finish(Response.json({ scoreId: "restored" })));
  expect(complete).not.toHaveBeenCalled();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
});
