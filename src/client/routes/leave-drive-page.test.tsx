import { activateAuthenticatedLocalOwner } from "../platform/local-workspace";
import { localDatabase } from "../platform/local-database";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import LeaveDrivePage from "./leave-drive-page";
vi.mock("../auth/auth-client", () => ({ authClient: { useSession: () => ({ data: { user: { id: "member" } } }) } }));
beforeEach(async () => { await localDatabase.open(); await activateAuthenticatedLocalOwner("member"); });
afterEach(() => vi.unstubAllGlobals());
function setup(isOwner = 0, isPreviewEntry = 0) {
  let displayName = "小林", revision = 3;
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "PATCH") {
      displayName = JSON.parse(String(init.body)).displayName; revision += 1;
      return Response.json({ revision });
    }
    if (init?.method) return new Response(null, { status: 204 });
    if (url.endsWith("/settings")) return Response.json({ name: "排练云盘", displayName, membershipRevision: revision, nameRevision: 0, canEditDriveInfo: false });
    return Response.json({ userId: "member", reauthenticated: false, methods: [], deletion: null, memberships: [{ id: "membership", choirId: "drive", name: "排练云盘", displayName, isPreviewEntry, isOwner, status: "active", revision, removedAt: null }] });
  });
  vi.stubGlobal("fetch", fetch);
  render(<MemoryRouter initialEntries={["/choirs/drive/me"]}><Routes><Route path="/choirs/:choirId/me" element={<LeaveDrivePage />} /><Route path="/drives" element={<h1>我的云盘</h1>} /></Routes></MemoryRouter>);
  return fetch;
}
it("requires named membership confirmation and preserves the lifecycle revision", async () => {
  const fetch = setup();
  fireEvent.click(await screen.findByRole("button", { name: "退出此云盘" }));
  expect(screen.getByRole("dialog", { name: "退出「排练云盘」的成员身份" })).toBeVisible();
  expect(screen.getByText(/云端个人层保留三十天/)).toBeVisible();
  expect(fetch.mock.calls.some(([, init]) => init?.method)).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "确认退出成员身份" }));
  expect(await screen.findByRole("heading", { name: "我的云盘" })).toBeVisible();
  expect((await localDatabase.driveDirectories.toArray())[0].accessRevoked).toBe(true);
  expect(fetch).toHaveBeenCalledWith("/api/choirs/drive/memberships/membership", expect.objectContaining({ method: "POST", body: JSON.stringify({ action: "remove", expectedRevision: 3 }) }));
});
it("requires the owner to transfer ownership before leaving", async () => {
  setup(1);
  expect(await screen.findByRole("button", { name: "退出此云盘" })).toBeDisabled();
  expect(screen.getByRole("link", { name: "管理成员与交接" })).toBeVisible();
});

it("explains the actual preview exception without suggesting personal-layer expiry", async () => {
  setup(0, 1);
  fireEvent.click(await screen.findByRole("button", { name: "退出此云盘" }));
  expect(screen.getByText(/我的笔记仍可使用，不进入三十天保留期/)).toBeVisible();
  expect(screen.queryByText(/云端个人层保留三十天/)).not.toBeInTheDocument();
});

it("edits the local display name and rereads membership revision before leaving", async () => {
  const fetch = setup();
  expect(await screen.findByText("小林")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "修改显示名" }));
  fireEvent.change(await screen.findByRole("textbox", { name: "我在此云盘的显示名" }), { target: { value: "林同学" } });
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  expect(await screen.findByText("林同学")).toBeVisible();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(fetch).toHaveBeenCalledWith("/api/choirs/drive/display-name", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ displayName: "林同学", expectedRevision: 3 }) }));
  fireEvent.click(screen.getByRole("button", { name: "退出此云盘" }));
  fireEvent.click(screen.getByRole("button", { name: "确认退出成员身份" }));
  await screen.findByRole("heading", { name: "我的云盘" });
  expect(fetch).toHaveBeenCalledWith("/api/choirs/drive/memberships/membership", expect.objectContaining({ method: "POST", body: JSON.stringify({ action: "remove", expectedRevision: 4 }) }));
});
