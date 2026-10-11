import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import { PreparedScoreLink } from "./prepared-score-link";

const prepare = vi.hoisted(() => vi.fn());
vi.mock("../offline/use-offline-score", () => ({ useOfflineScore: () => undefined, useOfflinePreparation: () => ({ state: { phase: "idle" }, prepare }) }));
vi.mock("dexie-react-hooks", () => ({ useLiveQuery: () => null }));
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
beforeEach(() => { prepare.mockReset(); Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { getRegistration: async () => ({ active: {} }) } }); });
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
