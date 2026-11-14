import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import { PreparedScoreLink } from "./prepared-score-link";

const load = vi.hoisted(() => vi.fn());
const offline = vi.hoisted(() => ({ ready: false }));
vi.mock("../reader/reader-document-cache", () => ({ acquireReaderDocument: load }));
vi.mock("../offline/use-offline-score", () => ({ useOfflineScore: (workspace: { scopeKey: string } | null) => offline.ready && workspace ? { scopeKey: workspace.scopeKey, record: {}, invalid: false } : undefined }));
vi.mock("dexie-react-hooks", () => ({ useLiveQuery: () => null }));
const score = { id: "score", choirId: "drive", fileName: "排练.pdf", updatedAt: 1, currentVersion: { id: "v1", versionNumber: 1, sizeBytes: 100, sha256: "a".repeat(64), etag: "v1", pageCount: 1, createdAt: 1 } };
function Route() { return <div aria-label="当前位置">{useLocation().pathname}</div>; }
function row(id = "score", sessionId = "session", versionId = "v1") {
  return <PreparedScoreLink score={{ ...score, id, currentVersion: { ...score.currentVersion, id: versionId } }} sessionId={sessionId} userId="user" choirId="drive" scoreId={id} local={false} label={id} description="排练谱" onOpen={() => {}}>{id}</PreparedScoreLink>;
}
function pending() {
  let resolve!: (value: object) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<object>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject, release: vi.fn() };
}
afterEach(() => vi.useRealTimers());
beforeEach(() => { offline.ready = false; load.mockReset(); });
it("keeps failed uncached opens in the list and retries by clicking again", async () => {
  const task = pending(); load.mockReturnValue(task);
  render(<MemoryRouter initialEntries={["/choirs/drive"]}>{row()}<Route /></MemoryRouter>);
  fireEvent.click(screen.getByRole("link", { name: "score" }));
  fireEvent.click(screen.getByRole("link", { name: "score" }));
  expect(load).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("status")).toHaveTextContent("正在打开");
  expect(screen.getByLabelText("当前位置")).toHaveTextContent(/^\/choirs\/drive$/);
  await act(async () => task.reject(new TypeError("Failed to fetch")));
  expect(screen.getByRole("alertdialog")).toHaveTextContent("乐谱未能打开，请检查网络后重试。");
  const retry = pending(); load.mockReturnValue(retry);
  fireEvent.click(screen.getByRole("link", { name: "score" }));
  await act(async () => retry.resolve({}));
  expect(screen.getByLabelText("当前位置")).toHaveTextContent("/choirs/drive/scores/score");
  expect(task.release).toHaveBeenCalledTimes(1);
});
it.each(["cancel", "unmount", "another score", "session change", "version change"])("ignores late completion after %s", async reason => {
  const task = pending(), next = pending(); load.mockReturnValueOnce(task).mockReturnValueOnce(next);
  const view = render(<MemoryRouter initialEntries={["/choirs/drive"]}>{row()}{row("next")}<Route /></MemoryRouter>);
  fireEvent.click(screen.getByRole("link", { name: "score" }));
  if (reason === "cancel") fireEvent.click(screen.getByRole("button", { name: /取消打开/ }));
  if (reason === "session change") view.rerender(<MemoryRouter>{row("score", "new-session")}<Route /></MemoryRouter>);
  if (reason === "version change") view.rerender(<MemoryRouter>{row("score", "session", "v2")}<Route /></MemoryRouter>);
  if (reason === "unmount") view.rerender(<MemoryRouter><Route /></MemoryRouter>);
  if (reason === "another score") fireEvent.click(screen.getByRole("link", { name: "next" }));
  await act(async () => task.resolve({}));
  expect(screen.getByLabelText("当前位置")).toHaveTextContent(/^\/choirs\/drive$/);
});
it("opens a verified cached score without a cloud load", () => {
  offline.ready = true;
  render(<MemoryRouter initialEntries={["/choirs/drive"]}>{row()}<Route /></MemoryRouter>);
  fireEvent.click(screen.getByRole("link", { name: "score" }));
  expect(load).not.toHaveBeenCalled();
  expect(screen.getByLabelText("当前位置")).toHaveTextContent("/scores/score");
});
it.each(["ctrlKey", "metaKey"])("preserves modified %s links", modifier => {
  render(<MemoryRouter>{row()}</MemoryRouter>);
  expect(fireEvent.click(screen.getByRole("link", { name: "score" }), { [modifier]: true })).toBe(true);
  expect(load).not.toHaveBeenCalled();
});
