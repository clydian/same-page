import { act, fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, Link, Outlet, RouterProvider } from "react-router-dom";
import { useEffect, useState } from "react";
import { expect, it, vi } from "vitest";
import { NavigationProvider } from "./navigation";
import { useAppNavigation, useExitLayer } from "./navigation-context";
import { Dialog } from "./overlays";
import { Modal, ModalOverlay } from "react-aria-components";
import { TaskHeader } from "../components/task-header";

function Page({ save }: { save: () => Promise<boolean> }) {
  const [editing, edit] = useState(true);
  const [open, setOpen] = useState(true);
  useExitLayer(editing, "editing", async () => { if (!await save()) return false; edit(false); return true; });
  const navigation = useAppNavigation();
  return <><button onClick={() => navigation.back("/library")}>返回</button><p>{editing ? "编辑中" : "阅读中"}</p><Link to="/settings">个人设置</Link>
    <ModalOverlay isOpen={open} onOpenChange={setOpen}><Modal><Dialog aria-label="图层">图层<Link to="/settings">打开设置</Link></Dialog></Modal></ModalOverlay></>;
}
function setup(save: () => Promise<boolean>) {
  const router = createMemoryRouter([{ element: <NavigationProvider><Outlet /></NavigationProvider>, children: [
    { path: "/library", element: <h1>云盘</h1> }, { path: "/reader", element: <Page save={save} /> }, { path: "/settings", element: <h1>设置</h1> },
  ] }], { initialEntries: ["/library", "/reader"], initialIndex: 1 });
  render(<RouterProvider router={router} />); return router;
}
it("consumes one overlay then durable editing before history leaves the score", async () => {
  const save = vi.fn(async () => true); const router = setup(save);
  await act(() => router.navigate(-1));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(save).not.toHaveBeenCalled();
  await act(() => router.navigate(-1));
  expect(screen.getByText("阅读中")).toBeInTheDocument(); expect(save).toHaveBeenCalledTimes(1);
  await act(() => router.navigate(-1)); expect(screen.getByRole("heading", { name: "云盘" })).toBeInTheDocument();
});

it("returns to an explicit settings parent after guarding a changed form, regardless of history", async () => {
  const { useUnsavedChanges } = await import("../settings/use-unsaved-changes");
  function Settings() {
    const [dirty, setDirty] = useState(true);
    const confirmation = useUnsavedChanges({ dirty, save: async () => false, discard: () => setDirty(false) });
    return <><TaskHeader title="设置详情" backTo="/library" backBehavior="parent" />{confirmation}</>;
  }
  const router = createMemoryRouter([{ element: <NavigationProvider><Outlet /></NavigationProvider>, children: [
    { path: "/library", element: <h1>云盘</h1> }, { path: "/directory", element: <h1>旧布局目录</h1> }, { path: "/detail", element: <Settings /> },
  ] }], { initialEntries: ["/library", "/directory", "/detail"] });
  render(<RouterProvider router={router} />);
  fireEvent.click(screen.getByRole("button", { name: "返回" }));
  const continueEditing = await screen.findByRole("button", { name: "继续编辑" });
  await act(async () => { fireEvent.click(continueEditing); });
  expect(screen.getByRole("heading", { name: "设置详情" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "返回" }));
  fireEvent.click(await screen.findByRole("button", { name: "放弃修改" }));
  expect(await screen.findByRole("heading", { name: "云盘" })).toBeInTheDocument();
  expect(router.state.location.pathname).toBe("/library");
});

it.each([false, true])("reuses settings parent history after a forward jump=%s so system back does not reopen an exited task", async jump => {
  const router = createMemoryRouter([{ element: <NavigationProvider><Outlet /></NavigationProvider>, children: [
    { path: "/landing", element: <h1>入口</h1> },
    { path: "/library", element: <h1>云盘</h1> },
    { path: "/directory", element: <TaskHeader title="设置目录" backTo="/library" backBehavior="parent" /> },
    { path: "/detail", element: <TaskHeader title="设置详情" backTo="/directory" backBehavior="parent" /> },
  ] }], { initialEntries: ["/landing"] });
  render(<RouterProvider router={router} />);
  await act(() => router.navigate("/library"));
  const libraryKey = router.state.location.key;
  await act(() => router.navigate("/directory"));
  const directoryKey = router.state.location.key;
  await act(() => router.navigate("/detail"));
  if (jump) {
    await act(() => router.navigate(-2));
    await act(() => router.navigate(2));
  }
  fireEvent.click(screen.getByRole("button", { name: "返回" }));
  await screen.findByRole("heading", { name: "设置目录" });
  expect(router.state.location.key).toBe(directoryKey);
  fireEvent.click(screen.getByRole("button", { name: "返回" }));
  await screen.findByRole("heading", { name: "云盘" });
  expect(router.state.location.key).toBe(libraryKey);
  await act(() => router.navigate(-1));
  expect(screen.getByRole("heading", { name: "入口" })).toBeInTheDocument();
});
it("keeps the explicit internal target after closing a dialog and saving", async () => {
  const save = vi.fn(async () => true); setup(save);
  fireEvent.click(screen.getByRole("link", { name: "打开设置" }));
  expect(await screen.findByRole("heading", { name: "设置" })).toBeInTheDocument(); expect(save).toHaveBeenCalledTimes(1);
});
it("retains editing and retries when local persistence fails", async () => {
  const save = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true); const router = setup(save);
  await act(() => router.navigate(-1)); await act(() => router.navigate(-1));
  expect(screen.getByText("编辑中")).toBeInTheDocument(); expect(screen.getByRole("alert")).toHaveTextContent("本机保存未完成");
  fireEvent.click(screen.getByRole("button", { name: "重试" })); expect(await screen.findByText("阅读中")).toBeInTheDocument();
});

it("uses the latest explicit destination while one local save is pending", async () => {
  let complete!: (ok: boolean) => void;
  const save = vi.fn(() => new Promise<boolean>(resolve => { complete = resolve; }));
  const router = setup(save);
  await act(() => router.navigate(-1));
  await act(async () => { void router.navigate("/settings"); });
  await act(async () => { void router.navigate("/library"); });
  await act(async () => complete(true));
  expect(await screen.findByRole("heading", { name: "云盘" })).toBeInTheDocument();
  expect(save).toHaveBeenCalledTimes(1);
});

it("retries the original internal destination after a failed save", async () => {
  const save = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true); setup(save);
  fireEvent.click(screen.getByRole("link", { name: "打开设置" }));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  expect(await screen.findByRole("heading", { name: "设置" })).toBeInTheDocument();
  expect(save).toHaveBeenCalledTimes(2);
});

it("closes the transient picker before navigation and keeps it closed on return", async () => {
  const { DriveHeader } = await import("../score-library/drive-header");
  const router = createMemoryRouter([{ element: <NavigationProvider><Outlet /></NavigationProvider>, children: [
    { path: "/choirs/one", element: <DriveHeader choirId="one" choirName="排练" search="" onSearch={() => {}} /> },
    { path: "/drives", element: <h1>云盘列表内容</h1> },
  ] }], { initialEntries: ["/choirs/one"] });
  render(<RouterProvider router={router} />);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /^切换云盘/ }));
  await screen.findByRole("dialog", { name: "切换云盘" });
  await act(() => router.navigate("/drives"));
  await screen.findByRole("heading", { name: "云盘列表内容" });
  await act(() => router.navigate(-1));
  await screen.findByRole("button", { name: /^切换云盘/ });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("asks before losing a changed form, keeps failed saves and returns after confirmed save", async () => {
  const { useUnsavedChanges } = await import("../settings/use-unsaved-changes");
  let succeeds = false;
  function Settings() {
    const [name, setName] = useState("");
    const navigation = useAppNavigation();
    const dialog = useUnsavedChanges({ dirty: Boolean(name), save: async () => succeeds, discard: () => setName("") });
    return <><input aria-label="名称" value={name} onChange={event => setName(event.target.value)} /><button onClick={() => navigation.back("/library")}>返回</button>{dialog}</>;
  }
  const router = createMemoryRouter([{ element: <NavigationProvider><Outlet /></NavigationProvider>, children: [
    { path: "/library", element: <h1>云盘</h1> }, { path: "/settings", element: <Settings /> },
  ] }], { initialEntries: ["/library", "/settings"] });
  render(<RouterProvider router={router} />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "新名称" } });
  fireEvent.click(screen.getByRole("button", { name: "返回" }));
  fireEvent.click(await screen.findByRole("button", { name: "继续编辑" }));
  expect(screen.getByRole("textbox")).toHaveValue("新名称");
  await act(() => router.navigate(-1));
  fireEvent.click(await screen.findByRole("button", { name: "保存并返回" }));
  expect(await screen.findByText("保存尚未确认，请核对后重试；修改仍保留。" )).toBeInTheDocument();
  succeeds = true;
  fireEvent.click(screen.getByRole("button", { name: "保存并返回" }));
  expect(await screen.findByRole("heading", { name: "云盘" })).toBeInTheDocument();
});

it("keeps a stable personal icon and known display name while membership is being restored", async () => {
  const { DriveHeader } = await import("../score-library/drive-header");
  const { rememberResource, readResource } = await import("../settings/read-resource");
  const key = { owner: "reader", driveId: "one", kind: "settings" } as const;
  const settings = { name: "排练", nameRevision: 0, displayName: "林老师", membershipRevision: 2, canEditDriveInfo: false };
  rememberResource(key, settings);
  let confirmMembership!: () => void;
  let finishSettings!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => { finishSettings = resolve; })));
  function RestoringHeader() {
    const [member, setMember] = useState(false);
    useEffect(() => { confirmMembership = () => setMember(true); }, []);
    return <DriveHeader loading={!member} choirId="one" choirName="排练" userId="reader" search="" onSearch={() => {}} canManageIdentity={member} />;
  }
  const router = createMemoryRouter([{ element: <NavigationProvider><Outlet /></NavigationProvider>, children: [
    { path: "/choirs/one", element: <RestoringHeader /> },
  ] }], { initialEntries: ["/choirs/one"] });
  render(<RouterProvider router={router} />);
  await act(async () => { await Promise.resolve(); });
  expect(screen.getByRole("button", { name: "我的" })).toHaveTextContent("");
  expect(readResource(key)).toEqual(settings);
  fireEvent.click(screen.getByRole("button", { name: "我的" }));
  await screen.findByRole("menuitem", { name: "阅读偏好" });
  expect(screen.getByRole("menuitem", { name: "林老师" })).toBeVisible();
  await act(async () => { confirmMembership(); finishSettings(Response.json({ ...settings, displayName: "小林" })); });
  expect(screen.getByRole("menuitem", { name: "阅读偏好" })).toBeVisible();
  expect(screen.getByRole("menuitem", { name: "云盘内身份" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "我的", hidden: true })).toHaveTextContent("")
  expect(screen.getByRole("menuitem", { name: "小林" })).toBeVisible();
});
