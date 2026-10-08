import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { NavigationProvider } from "../navigation/navigation";
import { InstallProvider } from "../install/install-provider";
import { DrivePreparation } from "./drive-preparation";

afterEach(() => vi.restoreAllMocks());
function mount(accountReady: boolean, installed = false) {
  vi.spyOn(window, "matchMedia").mockImplementation(query => ({ matches: installed && query === "(display-mode: standalone)", media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true }));
  return render(<MemoryRouter><NavigationProvider><InstallProvider><DrivePreparation choirId="drive" accountReady={accountReady} /></InstallProvider></NavigationProvider></MemoryRouter>);
}

it.each([
  { accountReady: false, installed: false, installation: true, login: null },
  { accountReady: true, installed: false, installation: true, login: null },
  { accountReady: false, installed: true, installation: false, login: "注册 / 登录，开始记笔记" },
  { accountReady: true, installed: true, installation: false, login: null },
])("shows only unfinished preparation: member=$accountReady installed=$installed", ({ accountReady, installed, installation, login }) => {
  mount(accountReady, installed);
  expect(Boolean(screen.queryByRole("button", { name: "添加到桌面" }))).toBe(installation);
  if (login) expect(screen.getByRole("link", { name: login })).toHaveAttribute("href", "/login?returnTo=%2Fchoirs%2Fdrive");
  else expect(screen.queryByRole("link")).not.toBeInTheDocument();
  expect(Boolean(screen.queryByRole("complementary", { name: "排练准备" }))).toBe(!(accountReady && installed));
});

it("does not mark an accepted installation request complete before confirmation", async () => {
  mount(true);
  const event = new Event("beforeinstallprompt", { cancelable: true });
  Object.defineProperty(event, "prompt", { value: async () => ({ outcome: "accepted" }) });
  act(() => window.dispatchEvent(event));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "添加到桌面" })));
  expect(screen.getByRole("complementary", { name: "排练准备", hidden: true })).toHaveTextContent("添加请求已提交");
  expect(screen.queryByText("已添加到桌面")).not.toBeInTheDocument();
  act(() => window.dispatchEvent(new Event("appinstalled")));
  expect(screen.queryByRole("complementary", { name: "排练准备", hidden: true })).not.toBeInTheDocument();
});
