import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registration, registrationUpdateMock, setRegistrationWaiting, setShouldNeedRefresh, updateServiceWorkerMock } from "../../test/pwa-register-mock";
import { holdUpdate } from "../updates/update-safety";
import { setUpdateStatus } from "../updates/update-status";
import { ReloadPrompt, UpdateDetails } from "./reload-prompt";

describe("background updates", () => {
  beforeEach(() => {
    setUpdateStatus("后台检查更新，当前版本继续运行", { ready: false, applying: false });
    setShouldNeedRefresh(true); setRegistrationWaiting(true);
    updateServiceWorkerMock.mockClear(); registrationUpdateMock.mockClear();
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  it("prepares silently and exposes prepared versus running state only in update details", async () => {
    const view = render(<MemoryRouter><ReloadPrompt /></MemoryRouter>);
    await waitFor(() => expect(registrationUpdateMock).toHaveBeenCalled());
    expect(screen.queryByText("有新版本可用")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    view.rerender(<MemoryRouter><ReloadPrompt /><UpdateDetails /></MemoryRouter>);
    expect(screen.getByText("新版本已准备，可在此更新并重新加载")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "更新并重新加载" })).toBeInTheDocument();
    expect(updateServiceWorkerMock).not.toHaveBeenCalled();
  });
  it("keeps the current build while offline and lets a failed check be retried", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    render(<MemoryRouter><ReloadPrompt /><UpdateDetails /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "检查更新" }));
    expect(screen.getByText("当前离线，继续使用当前版本")).toBeInTheDocument();
    expect(updateServiceWorkerMock).not.toHaveBeenCalled();
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    registrationUpdateMock.mockRejectedValueOnce(new Error("network"));
    fireEvent.click(screen.getByRole("button", { name: "检查更新" }));
    expect(await screen.findByText("更新检查失败，请稍后重试")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "检查更新" }));
    expect(await screen.findByText("新版本已准备，可在此更新并重新加载")).toBeInTheDocument();
  });

it("does not start a handover on idle time or a foreground update check", async () => {
  const post = vi.fn();
  registration.waiting!.postMessage = post;
  render(<MemoryRouter initialEntries={["/about"]}><ReloadPrompt /><UpdateDetails /></MemoryRouter>);
  await waitFor(() => expect(registrationUpdateMock).toHaveBeenCalled());
  vi.useFakeTimers();
  act(() => { vi.advanceTimersByTime(8000); });
  expect(post).not.toHaveBeenCalled();
  fireEvent(document, new Event("visibilitychange"));
  await act(async () => {});
  expect(registrationUpdateMock).toHaveBeenCalledTimes(2);
  expect(post).not.toHaveBeenCalled();
});

it("applies only on request, preserves operation vetoes and requires another request after a window veto", async () => {
  const ports: { onmessage: ((event: MessageEvent) => void) | null; close: () => void }[] = [];
  vi.stubGlobal("MessageChannel", class {
    port1 = { onmessage: null as ((event: MessageEvent) => void) | null, close: vi.fn() };
    port2 = {};
    constructor() { ports.push(this.port1); }
  });
  const post = vi.fn(); registration.waiting!.postMessage = post;
  render(<MemoryRouter initialEntries={["/about"]}><ReloadPrompt /><UpdateDetails /></MemoryRouter>);
  const apply = await screen.findByRole("button", { name: "更新并重新加载" });
  const release = holdUpdate();
  try { fireEvent.click(apply); expect(post).not.toHaveBeenCalled(); } finally { release(); }
  fireEvent.click(apply);
  expect(post).toHaveBeenCalledTimes(1);
  expect(post).toHaveBeenCalledWith({ type: "SAME_PAGE_SAFE_UPDATE", requested: true }, expect.any(Array));
  expect(apply).toBeDisabled();
  act(() => ports[0].onmessage?.(new MessageEvent("message", { data: { safe: false } })));
  expect(apply).toBeEnabled();
  vi.useFakeTimers();
  act(() => { vi.advanceTimersByTime(5000); });
  expect(post).toHaveBeenCalledTimes(1);
  fireEvent.click(apply);
  expect(post).toHaveBeenCalledTimes(2);
});
it("vetoes legacy automatic probes while preserving explicit cross-window safety checks", async () => {
  let probe!: (event: MessageEvent) => void;
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: {
    addEventListener: (_name: string, listener: (event: MessageEvent) => void) => { probe = listener; },
    removeEventListener: vi.fn(),
  } });
  render(<MemoryRouter initialEntries={["/about"]}><ReloadPrompt /></MemoryRouter>);
  await waitFor(() => expect(registrationUpdateMock).toHaveBeenCalled());
  vi.useFakeTimers();
  act(() => { vi.advanceTimersByTime(5000); });
  const reply = vi.fn();
  probe({ data: { type: "SAME_PAGE_UPDATE_PROBE" }, ports: [{ postMessage: reply }] } as unknown as MessageEvent);
  expect(reply).toHaveBeenLastCalledWith(false);
  probe({ data: { type: "SAME_PAGE_UPDATE_PROBE", requested: true }, ports: [{ postMessage: reply }] } as unknown as MessageEvent);
  expect(reply).toHaveBeenLastCalledWith(true);
  const release = holdUpdate();
  try {
    probe({ data: { type: "SAME_PAGE_UPDATE_PROBE", requested: true }, ports: [{ postMessage: reply }] } as unknown as MessageEvent);
    expect(reply).toHaveBeenLastCalledWith(false);
  } finally { release(); Reflect.deleteProperty(navigator, "serviceWorker"); }
});
});
