import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import { PreparedScoreLink } from "./prepared-score-link";

const prepare = vi.hoisted(() => vi.fn());
const guest = vi.hoisted(() => ({ owner: null as string | null }));
vi.mock("../offline/use-offline-score", () => ({ useOfflineScore: () => undefined, useOfflinePreparation: () => ({ state: { phase: "idle" }, prepare }) }));
vi.mock("dexie-react-hooks", () => ({ useLiveQuery: () => guest.owner }));
const score = { id: "score", choirId: "drive", fileName: "排练.pdf", updatedAt: 1, currentVersion: { id: "v1", versionNumber: 1, sizeBytes: 100, sha256: "a".repeat(64), etag: "v1", pageCount: 1, createdAt: 1 } };
function Route() { return <output aria-label="当前位置">{useLocation().pathname}</output>; }
function row(id = "score", sessionId = "session") {
  return <PreparedScoreLink score={{ ...score, id }} sessionId={sessionId} canPrepare userId="user" choirId="drive" scoreId={id} local={false} label={id} description="排练谱" onOpen={() => {}}><span>{id}</span></PreparedScoreLink>;
}
function pending() {
  let resolve!: (value: { phase: string; record?: object }) => void;
  const promise = new Promise<{ phase: string; record?: object }>(yes => { resolve = yes; });
  return { promise, resolve };
}
beforeEach(() => { guest.owner = null; prepare.mockReset(); Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { getRegistration: async () => ({ active: {} }) } }); });
it.each(["ctrlKey", "metaKey"])("leaves %s activation to the browser without preparing or navigating the opener", async modifier => {
  const registration = vi.spyOn(navigator.serviceWorker, "getRegistration");
  render(<MemoryRouter initialEntries={["/choirs/drive"]}>{row()}<Route /></MemoryRouter>);
  expect(fireEvent.click(screen.getByRole("link", { name: "score" }), { detail: 1, [modifier]: true })).toBe(true);
  await act(async () => {});
  expect(registration).not.toHaveBeenCalled();
  expect(prepare).not.toHaveBeenCalled();
  expect(screen.getByLabelText("当前位置")).toHaveTextContent(/^\/choirs\/drive$/);
});
it("never starts shell lookup or preparation after a withdrawn touch, but accepts the next tap", async () => {
  guest.owner = "guest:touch";
  const registration = vi.spyOn(navigator.serviceWorker, "getRegistration");
  prepare.mockResolvedValue({ phase: "ready", record: {} });
  render(<MemoryRouter initialEntries={["/choirs/drive"]}>{row()}<Route /></MemoryRouter>);
  const file = screen.getByRole("link", { name: "score" });
  const pointer = (type: string) => fireEvent(file, new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: "touch", pointerId: 1, isPrimary: true }));
  pointer("pointerdown"); pointer("contextmenu"); pointer("pointercancel");
  fireEvent.click(file, { detail: 1 });
  expect(registration).not.toHaveBeenCalled();
  expect(prepare).not.toHaveBeenCalled();
  expect(screen.getByLabelText("当前位置")).toHaveTextContent(/^\/choirs\/drive$/);
  pointer("pointerdown"); pointer("pointerup"); fireEvent.click(file, { detail: 1 });
  await waitFor(() => expect(prepare).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.getByLabelText("当前位置")).toHaveTextContent("/choirs/drive/scores/score"));
});
it("stays in the library, joins repeat clicks and opens only after preparation succeeds", async () => {
  const task = pending(); prepare.mockReturnValue(task.promise);
  render(<MemoryRouter initialEntries={["/choirs/drive"]}>{row()}<Route /></MemoryRouter>);
  fireEvent.click(screen.getByRole("link", { name: "score" }));
  fireEvent.click(screen.getByRole("link", { name: "score" }));
  await waitFor(() => expect(prepare).toHaveBeenCalledTimes(1));
  expect(screen.getByLabelText("当前位置")).toHaveTextContent("/choirs/drive");
  expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  await act(async () => task.resolve({ phase: "ready", record: {} }));
  await waitFor(() => expect(screen.getByLabelText("当前位置")).toHaveTextContent("/choirs/drive/scores/score"));
});
it.each(["unmount", "another score", "session change"])("does not navigate on late completion after %s", async reason => {
  const old = pending(), next = pending(); prepare.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
  const view = render(<MemoryRouter initialEntries={["/choirs/drive"]}>{row()}{row("next")}<Route /></MemoryRouter>);
  fireEvent.click(screen.getByRole("link", { name: "score" }));
  await waitFor(() => expect(prepare).toHaveBeenCalledTimes(1));
  if (reason === "session change") view.rerender(<MemoryRouter>{row("score", "new-session")}<Route /></MemoryRouter>);
  if (reason === "unmount") view.rerender(<MemoryRouter><Route /></MemoryRouter>);
  if (reason === "another score") fireEvent.click(screen.getByRole("link", { name: "next" }));
  await act(async () => old.resolve({ phase: "ready", record: {} }));
  expect(screen.getByLabelText("当前位置")).toHaveTextContent("/choirs/drive");
});
it("retries a failed open by clicking the score again without adding row controls", async () => {
  prepare.mockResolvedValueOnce({ phase: "failed", reason: "download" }).mockResolvedValueOnce({ phase: "ready", record: {} });
  render(<MemoryRouter initialEntries={["/choirs/drive"]}>{row()}<Route /></MemoryRouter>);
  fireEvent.click(screen.getByRole("link", { name: "score" }));
  await waitFor(() => expect(prepare).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("link", { name: "score" }));
  await waitFor(() => expect(screen.getByLabelText("当前位置")).toHaveTextContent("/choirs/drive/scores/score"));
});

it("opens online immediately when this browser has no active offline shell", async () => {
  navigator.serviceWorker.getRegistration = async () => undefined;
  render(<MemoryRouter initialEntries={["/choirs/drive"]}>{row()}<Route /></MemoryRouter>);
  fireEvent.click(screen.getByRole("link", { name: "score" }));
  await waitFor(() => expect(screen.getByLabelText("当前位置")).toHaveTextContent("/choirs/drive/scores/score"));
  expect(prepare).not.toHaveBeenCalled();
});

it("opens a first-time guest immediately while local ownership is still being established", async () => {
  let registration!: (value: undefined) => void;
  navigator.serviceWorker.getRegistration = () => new Promise(resolve => { registration = resolve; });
  const guestRow = () => <PreparedScoreLink score={score} sessionId={null} canPrepare choirId="drive" scoreId="score" local={false} experience label="guest" description="排练谱" onOpen={() => {}}>guest</PreparedScoreLink>;
  const view = render(<MemoryRouter initialEntries={["/choirs/drive"]}>{guestRow()}<Route /></MemoryRouter>);
  fireEvent.click(screen.getByRole("link", { name: "guest" }));
  guest.owner = "guest:first-visit";
  view.rerender(<MemoryRouter>{guestRow()}<Route /></MemoryRouter>);
  await act(async () => registration?.(undefined));
  await waitFor(() => expect(screen.getByLabelText("当前位置")).toHaveTextContent("/choirs/drive/scores/score"));
  expect(prepare).not.toHaveBeenCalled();
});

it("keeps an online open across a transient preparation-availability refresh", async () => {
  let registration!: (value: undefined) => void;
  navigator.serviceWorker.getRegistration = () => new Promise(resolve => { registration = resolve; });
  const renderRow = (canPrepare: boolean) => <PreparedScoreLink score={score} sessionId="session" canPrepare={canPrepare} userId="user" choirId="drive" scoreId="score" local={false} label="score" description="排练谱" onOpen={() => {}}>score</PreparedScoreLink>;
  const view = render(<MemoryRouter initialEntries={["/choirs/drive"]}>{renderRow(true)}<Route /></MemoryRouter>);
  fireEvent.click(screen.getByRole("link", { name: "score" }));
  view.rerender(<MemoryRouter>{renderRow(false)}<Route /></MemoryRouter>);
  view.rerender(<MemoryRouter>{renderRow(true)}<Route /></MemoryRouter>);
  await act(async () => registration(undefined));
  await waitFor(() => expect(screen.getByLabelText("当前位置")).toHaveTextContent("/choirs/drive/scores/score"));
  expect(prepare).not.toHaveBeenCalled();
});

it.each(["session", "version", "guest owner", "unmount"])("still cancels a pending shell lookup after %s changes", async change => {
  let registration!: (value: undefined) => void;
  navigator.serviceWorker.getRegistration = () => new Promise(resolve => { registration = resolve; });
  guest.owner = "guest:first";
  const renderRow = (changed = false) => <PreparedScoreLink score={changed && change === "version" ? { ...score, currentVersion: { ...score.currentVersion, id: "v2" } } : score} sessionId={changed && change === "session" ? "new-session" : "session"} canPrepare choirId="drive" scoreId="score" local={false} label="score" description="排练谱" onOpen={() => {}}>score</PreparedScoreLink>;
  const view = render(<MemoryRouter initialEntries={["/choirs/drive"]}>{renderRow()}<Route /></MemoryRouter>);
  fireEvent.click(screen.getByRole("link", { name: "score" }));
  if (change === "guest owner") guest.owner = "guest:second";
  view.rerender(<MemoryRouter>{change !== "unmount" && renderRow(true)}<Route /></MemoryRouter>);
  await act(async () => registration(undefined));
  expect(screen.getByLabelText("当前位置")).toHaveTextContent(/^\/choirs\/drive$/);
  expect(prepare).not.toHaveBeenCalled();
});
