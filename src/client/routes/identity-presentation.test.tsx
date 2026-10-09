import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import DriveLayerPreferencesPage from "./drive-layer-preferences-page";
import DriveManagementPage from "./drive-management-page";
import PersonalSettingsPage from "./personal-settings-page";
import { localDatabase } from "../platform/local-database";
import { activateAuthenticatedLocalOwner } from "../platform/local-workspace";
import { getReadResource } from "../settings/read-resource";
import { observeNavigationSession } from "../settings/navigation-events";
import { noCapabilities } from "../../shared/drive-permissions";
const identity = vi.hoisted(() => ({ data: null as { user: { id: string; email: string } } | null, pending: true }));
vi.mock("../auth/auth-client", () => ({ authClient: { useSession: () => ({ data: identity.data, isPending: identity.pending }) } }));
beforeEach(async () => { await localDatabase.open(); identity.data = null; identity.pending = true; observeNavigationSession(null); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); observeNavigationSession(null); });
function tree(element: React.ReactNode, path = "/choirs/drive/preferences") {
  return <MemoryRouter initialEntries={[path]}><Routes><Route path="/choirs/:choirId/preferences" element={element} /><Route path="/choirs/:choirId/settings/admission" element={element} /></Routes></MemoryRouter>;
}
it("does not invite login while the local identity for preferences is being restored", async () => {
  await activateAuthenticatedLocalOwner("user");
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
  render(tree(<DriveLayerPreferencesPage />));
  expect(screen.queryByRole("link", { name: "登录后设置默认显示" })).not.toBeInTheDocument();
  expect(await screen.findByText("更改自动保存")).toBeInTheDocument();
});
it("does not claim signed-in status before identity is known on the account page", () => {
  render(<MemoryRouter><PersonalSettingsPage /></MemoryRouter>);
  expect(screen.queryByText("已登录")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "退出登录" })).not.toBeInTheDocument();
});
it("waits for identity then retains an edited settings form through same-user reconfirmation", async () => {
  await activateAuthenticatedLocalOwner("user");
  observeNavigationSession(null, "user", true);
  const capabilities = noCapabilities(); capabilities.operations.operations.push("editDriveInfo");
  const fetch = vi.fn(async (input: RequestInfo | URL) => Response.json(String(input).endsWith("/management")
    ? { name: "排练云盘", isMember: true, guestAdmissionMode: "invite", capabilities, layers: [] }
    : { name: "排练云盘", displayName: "歌者", nameRevision: 1, membershipRevision: 1, canEditDriveInfo: true }));
  vi.stubGlobal("fetch", fetch);
  const view = render(tree(<DriveManagementPage section="info" />, "/choirs/drive/settings/admission"));
  await act(async () => {});
  expect(fetch).not.toHaveBeenCalled();
  identity.data = { user: { id: "user", email: "user@example.test" } }; identity.pending = false;
  act(() => observeNavigationSession("user:session", "user"));
  view.rerender(tree(<DriveManagementPage section="info" />, "/choirs/drive/settings/admission"));
  fireEvent.click(await screen.findByRole("button", { name: "修改云盘名称" }));
  const field = await screen.findByRole("textbox", { name: "云盘名称" });
  await waitFor(() => expect(field).toHaveValue("排练云盘"));
  fireEvent.change(field, { target: { value: "我的修改" } });
  act(() => observeNavigationSession(null, "user", true));
  identity.data = null; identity.pending = true;
  view.rerender(tree(<DriveManagementPage section="info" />, "/choirs/drive/settings/admission"));
  expect(screen.getByRole("textbox", { name: "云盘名称" })).toBe(field);
  expect(field).toHaveValue("我的修改");
  expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
  act(() => observeNavigationSession("user:session", "user"));
  identity.data = { user: { id: "user", email: "user@example.test" } }; identity.pending = false;
  view.rerender(tree(<DriveManagementPage section="info" />, "/choirs/drive/settings/admission"));
  expect(field).toHaveValue("我的修改");
});
it("keeps known trash visible offline and pauses restore instead of showing permission instructions", async () => {
  identity.data = { user: { id: "user", email: "user@example.test" } }; identity.pending = false;
  let online = true; vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
  const capabilities = noCapabilities(); capabilities.operations.operations.push("trashFiles");
  getReadResource({ owner: "user", driveId: "drive", kind: "management" }).confirm({ name: "云盘", isMember: true, guestAdmissionMode: "invite", capabilities, layers: [] });
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ scores: [], attachments: [] })));
  render(tree(<DriveManagementPage section="trash" />, "/choirs/drive/settings/admission"));
  const trash = await screen.findByRole("region", { name: "回收站文件" });
  await act(async () => { online = false; window.dispatchEvent(new Event("offline")); });
  expect(trash).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "查看权限说明" })).not.toBeInTheDocument();
});


it("saves a drive name without waiting for the unrelated directory bootstrap", async () => {
  await activateAuthenticatedLocalOwner("user");
  identity.data = { user: { id: "user", email: "user@example.test" } }; identity.pending = false;
  const capabilities = noCapabilities(); capabilities.operations.operations.push("editDriveInfo");
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith("/bootstrap")) return new Promise<Response>(() => {});
    if (init?.method === "PATCH") return Response.json({ revision: 2 });
    return Response.json(String(input).endsWith("/management")
      ? { name: "排练云盘", isMember: true, guestAdmissionMode: "invite", capabilities, layers: [] }
      : { name: "排练云盘", displayName: "歌者", nameRevision: 1, membershipRevision: 1, canEditDriveInfo: true });
  }));
  render(tree(<DriveManagementPage section="info" />, "/choirs/drive/settings/admission"));
  fireEvent.click(await screen.findByRole("button", { name: "修改云盘名称" }));
  const field = await screen.findByRole("textbox", { name: "云盘名称" });
  await waitFor(() => expect(field).toHaveValue("排练云盘"));
  fireEvent.change(field, { target: { value: "新名称" } });
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(() => expect(screen.queryByRole("textbox", { name: "云盘名称" })).not.toBeInTheDocument());
});
