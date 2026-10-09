import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TrashContents } from "./trash-contents";
import { AttachmentTrash } from "./attachments/attachment-trash";
vi.mock("../drives/purge-dialog", () => ({ PurgeDialog: () => <div role="alertdialog">删除确认</div> }));
afterEach(() => vi.unstubAllGlobals());
const score = { id: "score", choirId: "drive", fileName: "排练.pdf", updatedAt: 1, trashedAt: 1, trashExpiresAt: Date.now() + 86400000,
  currentVersion: { id: "v", versionNumber: 1, sizeBytes: 100, sha256: "hash", etag: "etag", pageCount: 1, createdAt: 1 } };
const attachment = { id: "attachment", scoreId: "score", name: "练习音频", scoreName: "排练", kind: "audio", url: null, sizeBytes: 10, revision: 1, updatedAt: 1, trashExpiresAt: Date.now() + 86400000 };
it.each([401, 403, 404, 503])("handles %i after resuming a retained trash view", async status => {
  let denied = false;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).endsWith("attachments/trash")
    ? Response.json({ attachments: [] }) : denied ? new Response(null, { status }) : Response.json({ scores: [score], storage: { usedBytes: 100, limitBytes: 1000 } })));
  const view = render(<TrashContents userId="user" choirId="drive" onRestored={() => {}} />);
  const row = await screen.findByText("排练");
  view.rerender(<TrashContents userId="user" choirId="drive" writable={false} onRestored={() => {}} />);
  denied = true;
  view.rerender(<TrashContents userId="user" choirId="drive" onRestored={() => {}} />);
  await screen.findByText(status === 401 ? "登录已失效，请重新登录后再试。" : status === 403 ? "你没有操作此设置的权限，请联系云盘拥有者。" : "暂时无法打开回收站。");
  if (status === 503) expect(row).toBeInTheDocument();
  else { expect(row).not.toBeInTheDocument(); expect(screen.queryByRole("button", { name: "恢复" })).not.toBeInTheDocument(); }
});
it.each([401, 403, 404, 503])("handles %i after resuming retained attachment trash", async status => {
  let denied = false;
  vi.stubGlobal("fetch", vi.fn(async () => denied ? new Response(null, { status }) : Response.json({ attachments: [attachment] })));
  const view = render(<AttachmentTrash choirId="drive" onRestored={() => {}} />);
  const row = await screen.findByText("练习音频");
  view.rerender(<AttachmentTrash choirId="drive" writable={false} onRestored={() => {}} />);
  denied = true;
  view.rerender(<AttachmentTrash choirId="drive" onRestored={() => {}} />);
  await screen.findByText(status === 401 ? "登录已失效，请重新登录后再试。" : status === 403 ? "你没有操作此设置的权限，请联系云盘拥有者。" : "暂时无法读取已删除的附件。");
  if (status === 503) expect(row).toBeInTheDocument();
  else { expect(row).not.toBeInTheDocument(); expect(screen.queryByRole("button", { name: "恢复" })).not.toBeInTheDocument(); }
});
it("does not reopen an old permanent-deletion confirmation after authority resumes", async () => {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).endsWith("attachments/trash") ? Response.json({ attachments: [] }) : Response.json({ scores: [score], storage: { usedBytes: 100, limitBytes: 1000 } })));
  const props = { userId: "user", choirId: "drive", canPurge: true, onRestored: () => {} };
  const view = render(<TrashContents {...props} />);
  fireEvent.click(await screen.findByRole("button", { name: "彻底删除" }));
  expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  view.rerender(<TrashContents {...props} writable={false} />);
  view.rerender(<TrashContents {...props} />);
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
});


it("does not reintroduce a restore conflict from a response that predates a writable pause", async () => {
  let reads = 0;
  let finish!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") return new Promise<Response>(resolve => { finish = resolve; });
    if (String(input).endsWith("attachments/trash")) return Response.json({ attachments: [] });
    reads++;
    return reads === 1 ? Response.json({ scores: [score], storage: { usedBytes: 100, limitBytes: 1000 } }) : new Response(null, { status: 403 });
  }));
  const props = { userId: "user", choirId: "drive", onRestored: () => {} };
  const view = render(<TrashContents {...props} />);
  fireEvent.click(await screen.findByRole("button", { name: "恢复" }));
  view.rerender(<TrashContents {...props} writable={false} />);
  view.rerender(<TrashContents {...props} />);
  await screen.findByText("你没有操作此设置的权限，请联系云盘拥有者。");
  await act(async () => finish(Response.json({ error: "filename_conflict" }, { status: 409 })));
  expect(screen.queryByRole("textbox", { name: "恢复时使用的新文件名" })).not.toBeInTheDocument();
});

it("ignores a late attachment restoration completion after writable authority changes", async () => {
  let reads = 0;
  let finish!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") return new Promise<Response>(resolve => { finish = resolve; });
    reads++;
    return reads === 1 ? Response.json({ attachments: [attachment] }) : new Response(null, { status: 403 });
  }));
  const onRestored = vi.fn();
  const view = render(<AttachmentTrash choirId="drive" onRestored={onRestored} />);
  fireEvent.click(await screen.findByRole("button", { name: "恢复" }));
  view.rerender(<AttachmentTrash choirId="drive" onRestored={onRestored} writable={false} />);
  view.rerender(<AttachmentTrash choirId="drive" onRestored={onRestored} />);
  await screen.findByText("你没有操作此设置的权限，请联系云盘拥有者。");
  await act(async () => finish(new Response(null, { status: 204 })));
  expect(onRestored).not.toHaveBeenCalled();
});

it("ignores a delayed conflict body after the retained view loses authority", async () => {
  let reads = 0;
  let finishBody!: (payload: unknown) => void;
  const response = new Response(null, { status: 409 });
  const body = vi.spyOn(response, "json").mockImplementation(() => new Promise(resolve => { finishBody = resolve; }));
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") return response;
    if (String(input).endsWith("attachments/trash")) return Response.json({ attachments: [] });
    reads++;
    return reads === 1 ? Response.json({ scores: [score], storage: { usedBytes: 100, limitBytes: 1000 } }) : new Response(null, { status: 403 });
  }));
  const props = { userId: "user", choirId: "drive", onRestored: () => {} };
  const view = render(<TrashContents {...props} />);
  fireEvent.click(await screen.findByRole("button", { name: "恢复" }));
  await vi.waitFor(() => expect(body).toHaveBeenCalled());
  view.rerender(<TrashContents {...props} writable={false} />);
  view.rerender(<TrashContents {...props} />);
  await screen.findByText("你没有操作此设置的权限，请联系云盘拥有者。");
  await act(async () => finishBody({ error: "filename_conflict" }));
  expect(screen.queryByRole("textbox", { name: "恢复时使用的新文件名" })).not.toBeInTheDocument();
});
