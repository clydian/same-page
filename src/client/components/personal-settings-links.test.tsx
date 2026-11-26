import { act, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { buildVersion } from "../../shared/build";
import { PersonalSettingsLinks } from "./personal-settings-links";

const identity = {
  localUserId: "operator", authenticatedUserId: "operator", authenticatedSessionId: "session-a",
  restoring: false, onlineState: "authenticated",
} as const;
const capabilities = { viewScores: 0, reviewXml: 0, publishXml: 0, manageReports: 0, manageReleases: 0, deleteReports: 0 };
type Overrides = Partial<ComponentProps<typeof PersonalSettingsLinks>>;
function settings(props?: Overrides) {
  return <MemoryRouter><PersonalSettingsLinks identity={identity} experience={false} {...props} /></MemoryRouter>;
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it.each([undefined, false, true])("keeps app and drive actions in their own scope (membership: %s)", canManageIdentity => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(capabilities)));
  render(settings({ drive: canManageIdentity === undefined ? undefined : { choirId: "drive-a", canManageIdentity } }));
  const app = within(screen.getByRole("region", { name: "应用设置" }));
  for (const [label, href] of [["账户", "/user"], ["外观", "/appearance"], ["使用手册", "/help"], ["问题反馈", "/diagnostics"], [`关于与更新 ${buildVersion}`, "/about"]]) {
    expect(app.getByRole("link", { name: label })).toHaveAttribute("href", href);
  }
  const drive = screen.queryByRole("region", { name: "当前云盘" });
  if (!drive) {
    expect(canManageIdentity).toBeUndefined();
    return;
  }
  expect(within(drive).getByRole("link", { name: "阅读偏好" })).toHaveAttribute("href", "/choirs/drive-a/preferences");
  expect(within(drive).getByRole("link", { name: "本机存储" })).toHaveAttribute("href", "/choirs/drive-a/storage");
  const membership = within(drive).queryByRole("link", { name: "云盘内身份" });
  if (canManageIdentity) expect(membership).toHaveAttribute("href", "/choirs/drive-a/me");
  else expect(membership).toBeNull();
});

it.each(["manageReleases", "viewScores", "manageReports"])("shows the product admin link after confirming %s", async capability => {
  const fetch = vi.fn(async () => Response.json({ ...capabilities, [capability]: 1 }));
  vi.stubGlobal("fetch", fetch);
  render(settings());
  expect(await screen.findByRole("link", { name: "产品后台" })).toHaveAttribute("href", "/admin");
  expect(fetch).toHaveBeenCalledOnce();
});

it.each(["denied", "unavailable", "no capabilities"])("keeps ordinary actions when product admin access is %s", async outcome => {
  const fetch = vi.fn(async () => {
    if (outcome === "unavailable") throw new TypeError("Network unavailable");
    return outcome === "denied" ? Response.json({ error: "forbidden" }, { status: 403 }) : Response.json(capabilities);
  });
  vi.stubGlobal("fetch", fetch);
  render(settings());
  await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  await act(async () => undefined);
  expect(screen.queryByRole("link", { name: "产品后台" })).toBeNull();
  expect(screen.getByRole("button", { name: "退出登录" })).toBeVisible();
});

it("ignores a late authorization response when the session changes", async () => {
  let finish!: (response: Response) => void;
  const fetch = vi.fn()
    .mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }))
    .mockResolvedValue(Response.json({ error: "forbidden" }, { status: 403 }));
  vi.stubGlobal("fetch", fetch);
  const { rerender } = render(settings());
  await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  rerender(settings({ identity: { ...identity, authenticatedUserId: "other", authenticatedSessionId: "session-b" } }));
  await act(async () => finish(Response.json({ ...capabilities, manageReleases: 1 })));
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("link", { name: "产品后台" })).toBeNull();
});

it("uses the separate appearance scope for experience", () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(capabilities)));
  render(settings({ experience: true }));
  expect(screen.getByRole("link", { name: "外观" })).toHaveAttribute("href", "/appearance?experience=1");
  expect(screen.getByRole("link", { name: "账户" })).toHaveAttribute("href", "/user");
});

it("keeps guest support and the original drive login return without member actions", () => {
  render(settings({ choirId: "drive-a", identity: {
    localUserId: null, authenticatedUserId: null, authenticatedSessionId: null, onlineState: "signed-out", restoring: false,
  } }));
  expect(screen.getByRole("link", { name: "登录" })).toHaveAttribute("href", "/login?returnTo=%2Fchoirs%2Fdrive-a");
  expect(screen.getByRole("link", { name: "使用手册" })).toBeVisible();
  expect(screen.queryByRole("region", { name: "当前云盘" })).toBeNull();
  expect(screen.queryByRole("button", { name: "退出登录" })).toBeNull();
});

it("requests product admin access only once online", async () => {
  let online = false;
  vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
  const fetch = vi.fn(async () => Response.json({ ...capabilities, manageReleases: 1 }));
  vi.stubGlobal("fetch", fetch);
  render(settings());
  expect(fetch).not.toHaveBeenCalled();
  online = true;
  act(() => { window.dispatchEvent(new Event("online")); });
  expect(await screen.findByRole("link", { name: "产品后台" })).toBeVisible();
  expect(fetch).toHaveBeenCalledOnce();
});
