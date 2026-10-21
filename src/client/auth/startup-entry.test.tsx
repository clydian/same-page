import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { StartupEntry } from "./startup-entry";
import type { ApplicationIdentity } from "./application-identity";
import { readLocalDriveDirectories } from "../score-library/local-drive-directory";

vi.mock("../score-library/local-drive-directory", () => ({ readLocalDriveDirectories: vi.fn() }));
vi.mock("../score-library/drive-page", () => ({ DrivePage: () => <p>正在加载乐谱…</p> }));

const identity = { authenticatedUserId: "user-a", localUserId: "user-a", onlineState: "authenticated", restoring: false } as ApplicationIdentity;
const memberships = ["one", "two"].map(id => ({ id: `membership-${id}`, isOwner: false, displayName: "歌者", choir: { id, name: id, guestAdmissionMode: "invite" } }));
function open() {
  return render(<MemoryRouter><Routes>
    <Route path="/" element={<StartupEntry identity={identity}><p>首页</p></StartupEntry>} />
    <Route path="/drives" element={<p>云盘列表</p>} />
  </Routes></MemoryRouter>);
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); window.localStorage.clear(); });

it("can load authenticated cloud memberships while the local directory read is stalled", async () => {
  vi.mocked(readLocalDriveDirectories).mockImplementation(() => new Promise(() => {}));
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ memberships })));
  open();
  expect(await screen.findByText("云盘列表", {}, { timeout: 2000 })).toBeInTheDocument();
});

it("offers retry after a stalled cloud request, and the next attempt can recover", async () => {
  vi.useFakeTimers();
  vi.mocked(readLocalDriveDirectories).mockResolvedValue([]);
  let finishFirst!: (response: Response) => void;
  let firstSignal: AbortSignal | null | undefined;
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation((_input, init) => {
    firstSignal = init?.signal;
    return new Promise(resolve => { finishFirst = resolve; });
  });
  vi.stubGlobal("fetch", fetch);
  open();
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
  expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
  expect(screen.queryByText("正在恢复云盘…")).not.toBeInTheDocument();
  expect(firstSignal?.aborted).toBe(true);
  fetch.mockResolvedValue(Response.json({ memberships }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "重试" })); });
  expect(screen.getByText("云盘列表")).toBeInTheDocument();
  await act(async () => { finishFirst(Response.json({ memberships: [] })); });
  expect(screen.getByText("云盘列表")).toBeInTheDocument();
});

it("offers a recovery action when local identity cannot finish restoring", async () => {
  vi.useFakeTimers();
  const restoring = { ...identity, authenticatedUserId: null, localUserId: null, onlineState: "checking" as const, restoring: true };
  render(<MemoryRouter><StartupEntry identity={restoring}><p>首页</p></StartupEntry></MemoryRouter>);
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
  expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "反馈问题" })).toHaveAttribute("href", "/diagnostics");
  expect(screen.queryByText("正在恢复云盘…")).not.toBeInTheDocument();
});
