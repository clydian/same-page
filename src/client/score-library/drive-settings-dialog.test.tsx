import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { observeNavigationSession } from "../settings/navigation-events";
import { DriveSettingsDialog } from "./drive-settings-dialog";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); observeNavigationSession(null); });
it("retains the draft after a revision conflict and requires a deliberate resave against refreshed settings", async () => {
  let revision = 0;
  const writes: unknown[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
    if (init?.method === "PATCH") {
      writes.push(JSON.parse(init.body));
      return writes.length === 1 ? new Response(null, { status: 409 }) : Response.json({ revision: 2 });
    }
    return Response.json({ name: "云盘", nameRevision: 0, displayName: revision++ ? "其他设备的新名" : "旧名", membershipRevision: revision - 1, canEditDriveInfo: false });
  }));
  const onSaved = vi.fn(async () => {});
  const onClose = vi.fn();
  render(<DriveSettingsDialog choirId="drive" userId="reader" field="display-name" onSaved={onSaved} onClose={onClose} />);
  const input = await screen.findByDisplayValue("旧名");
  fireEvent.change(input, { target: { value: "我的新名" } });
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  await screen.findByText(/其他设备的新名/);
  expect(input).toHaveValue("我的新名");
  expect(onSaved).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(writes).toEqual([{ displayName: "我的新名", expectedRevision: 0 }, { displayName: "我的新名", expectedRevision: 1 }]);
});

it("reopens with the known name and revision while a delayed refresh preserves the draft", async () => {
  let release!: (response: Response) => void;
  let reads = 0;
  const known = { name: "云盘", nameRevision: 0, displayName: "旧名", membershipRevision: 4, canEditDriveInfo: false };
  const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
    if (init?.method === "PATCH") return Response.json({ revision: 5 });
    reads++;
    return reads === 1 ? Response.json(known) : new Promise<Response>(resolve => { release = resolve; });
  });
  vi.stubGlobal("fetch", fetchMock);
  const props = { choirId: "drive", userId: "reader", field: "display-name" as const, onSaved: async () => {}, onClose: () => {} };
  const first = render(<DriveSettingsDialog {...props} />);
  await screen.findByDisplayValue("旧名"); first.unmount();
  const now = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(now + 60_001);
  render(<DriveSettingsDialog {...props} />);
  const input = screen.getByDisplayValue("旧名");
  expect(input).toBeEnabled();
  fireEvent.change(input, { target: { value: "正在编辑" } });
  await waitFor(() => expect(reads).toBe(2));
  release(Response.json({ ...known, displayName: "远端改名", membershipRevision: 5 }));
  await waitFor(() => expect(screen.getByRole("button", { name: "保存" })).toBeEnabled());
  expect(input).toHaveValue("正在编辑");
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("display-name"), expect.objectContaining({ body: JSON.stringify({ displayName: "正在编辑", expectedRevision: 4 }) })));
});

it("retries only refreshing after a confirmed name save", async () => {
  const fetchMock = vi.fn<typeof fetch>(async (_url, init) => Response.json(init?.method === "PATCH" ? { revision: 1 } : { name: "云盘", nameRevision: 0, displayName: "旧名", membershipRevision: 0, canEditDriveInfo: false }));
  vi.stubGlobal("fetch", fetchMock);
  const onSaved = vi.fn().mockRejectedValueOnce(new Error("refresh unavailable")).mockResolvedValue(undefined);
  const onClose = vi.fn();
  render(<DriveSettingsDialog choirId="drive" userId="reader" field="display-name" onSaved={onSaved} onClose={onClose} />);
  fireEvent.change(await screen.findByDisplayValue("旧名"), { target: { value: "新名" } });
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  await screen.findByText("修改已保存，内容刷新失败。请重试刷新。");
  fireEvent.click(screen.getByRole("button", { name: "重试刷新" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1);
});


it.each(["headers", "body"])("cancels an in-flight save while waiting for %s, retains the draft and requires a fresh read", async phase => {
  observeNavigationSession("reader:session", "reader");
  let finish!: (response: Response) => void;
  let finishBody!: (payload: unknown) => void;
  let signal!: AbortSignal;
  const settings = { name: "云盘", nameRevision: 0, displayName: "旧名", membershipRevision: 0, canEditDriveInfo: false };
  const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
    if (init?.method === "PATCH") {
      signal = init.signal!;
      if (phase === "body") {
        const response = new Response(null, { status: 200 });
        vi.spyOn(response, "json").mockImplementation(() => new Promise(resolve => { finishBody = resolve; }));
        return response;
      }
      return new Promise<Response>(resolve => { finish = resolve; });
    }
    return Response.json(settings);
  });
  vi.stubGlobal("fetch", fetch);
  const onSaved = vi.fn(async () => {});
  render(<DriveSettingsDialog choirId="drive" userId="reader" field="display-name" onSaved={onSaved} onClose={() => {}} />);
  const input = await screen.findByDisplayValue("旧名");
  fireEvent.change(input, { target: { value: "我的修改" } });
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(() => expect(phase === "body" ? finishBody : finish).toBeDefined());
  act(() => observeNavigationSession(null, "reader", true));
  expect(signal.aborted).toBe(true);
  expect(screen.getByRole("button", { name: "取消" })).toBeEnabled();
  expect(screen.getByRole("textbox", { name: "我在此云盘的显示名" })).toBe(input);
  expect(input).toHaveValue("我的修改");
  await act(async () => {
    if (phase === "body") finishBody({ revision: 1 });
    else finish(Response.json({ revision: 1 }));
  });
  act(() => observeNavigationSession("reader:session", "reader"));
  await waitFor(() => expect(screen.getByRole("button", { name: "重新读取" })).toBeEnabled());
  expect(onSaved).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "重新读取" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "保存" })).toBeEnabled());
  expect(input).toHaveValue("我的修改");
  expect(fetch.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1);
});


it.each([200, 403])("allows recovery after a transient resumed read failure and handles manual response %i through the resource", async status => {
  observeNavigationSession("reader:session", "reader");
  let reads = 0;
  const settings = { name: "云盘", nameRevision: 0, displayName: "旧名", membershipRevision: 0, canEditDriveInfo: false };
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (_url, init) => {
    if (init?.method === "PATCH") return new Promise<Response>(() => {});
    reads++;
    return reads === 2 ? new Response(null, { status: 503 }) : reads > 2 && status !== 200 ? new Response(null, { status }) : Response.json(settings);
  }));
  render(<DriveSettingsDialog choirId="drive" userId="reader" field="display-name" onSaved={async () => {}} onClose={() => {}} />);
  fireEvent.change(await screen.findByDisplayValue("旧名"), { target: { value: "我的修改" } });
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  act(() => observeNavigationSession(null, "reader", true));
  act(() => observeNavigationSession("reader:session", "reader"));
  await waitFor(() => expect(reads).toBe(2));
  const retry = screen.getByRole("button", { name: "重新读取" });
  expect(retry).toBeEnabled();
  fireEvent.click(retry);
  await waitFor(() => expect(reads).toBe(3));
  if (status === 200) await waitFor(() => expect(screen.getByRole("button", { name: "保存" })).toBeEnabled());
  else {
    await screen.findByText("你没有操作此设置的权限，请联系云盘拥有者。");
    expect(screen.getByRole("textbox")).toBeDisabled();
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
  }
});
