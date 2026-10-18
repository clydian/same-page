import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UpdateDetails } from "../components/reload-prompt";
import { UpdateController } from "./update-controller";
import { setUpdateRoute } from "./update-safety";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function worker() {
  return Object.assign(new EventTarget(), { state: "installing", postMessage: vi.fn() }) as unknown as ServiceWorker;
}
function state(value: ServiceWorker, next: ServiceWorkerState) {
  Object.assign(value, { state: next });
  value.dispatchEvent(new Event("statechange"));
}

describe("update lifecycle feedback", () => {
  let registration: ServiceWorkerRegistration;
  let controller: UpdateController;
  let update: ReturnType<typeof vi.fn>;
  let requested: ReturnType<typeof vi.fn<(value: boolean) => void>>;
  beforeEach(() => {
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: {} });
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    update = vi.fn(async () => {}); requested = vi.fn();
    registration = Object.assign(new EventTarget(), { installing: null, waiting: null, update }) as unknown as ServiceWorkerRegistration;
    setUpdateRoute("/about");
    controller = new UpdateController(registration, false, vi.fn(), requested);
  });
  afterEach(() => { controller.dispose(); vi.useRealTimers(); vi.unstubAllGlobals(); });
  function start() { controller.start(); render(<UpdateDetails />); }
  function install(value = worker()) {
    Object.assign(registration, { installing: value });
    registration.dispatchEvent(new Event("updatefound"));
    return value;
  }

  it("immediately disables the single checking button and coalesces clicks and foreground checks", async () => {
    const pending = deferred(); update.mockReturnValue(pending.promise);
    start();
    expect(screen.getByRole("button", { name: "检查中…" })).toBeDisabled();
    act(() => { void controller.check(); controller.foregroundCheck(); });
    fireEvent.click(screen.getByRole("button"));
    expect(update).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveAttribute("aria-atomic", "true");
    await act(async () => pending.resolve());
    expect(screen.getByText("检查完成，当前版本继续运行")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "检查更新" })).toBeEnabled();
  });

  it("waits for a slow installation after update() resolves, then offers only the reload action", async () => {
    start();
    let installing!: ServiceWorker;
    await act(async () => { installing = install(); });
    expect(screen.getByText("正在准备更新…，可以继续使用")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "准备中…" })).toBeDisabled();
    act(() => controller.foregroundCheck());
    expect(update).toHaveBeenCalledTimes(1);
    act(() => {
      Object.assign(registration, { installing: null, waiting: installing });
      state(installing, "installed");
    });
    expect(screen.getByText("更新已准备好")).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "重新加载并更新" })).toBeEnabled();
  });

  it("makes install failure visible and allows a fresh installation on retry", async () => {
    start();
    let first!: ServiceWorker;
    await act(async () => { first = install(); });
    act(() => { Object.assign(registration, { installing: null }); state(first, "redundant"); });
    expect(screen.getByText("更新准备失败，请重试；当前版本仍可使用")).toBeInTheDocument();
    const second = worker();
    update.mockImplementationOnce(async () => { install(second); });
    await act(async () => { await controller.check(); });
    expect(screen.getByRole("button", { name: "准备中…" })).toBeDisabled();
    act(() => state(first, "installed"));
    expect(screen.getByText("正在准备更新…，可以继续使用")).toBeInTheDocument();
    act(() => { Object.assign(registration, { installing: null, waiting: second }); state(second, "installed"); });
    expect(screen.getByText("更新已准备好")).toBeInTheDocument();
  });

  it("preserves an already waiting release when a newer installer fails", async () => {
    const waiting = worker();
    Object.assign(registration, { waiting });
    start();
    let newer!: ServiceWorker;
    await act(async () => { newer = install(); });
    act(() => { Object.assign(registration, { installing: null }); state(newer, "redundant"); });
    expect(screen.getByText("更新已准备好")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新加载并更新" })).toBeEnabled();
  });

  it("allows immediate retry after install failure even if update() has not settled", async () => {
    const pending = deferred(); update.mockReturnValueOnce(pending.promise);
    start();
    act(() => { const installing = install(); Object.assign(registration, { installing: null }); state(installing, "redundant"); });
    await act(async () => { await controller.check(); });
    expect(update).toHaveBeenCalledTimes(2);
    await act(async () => pending.resolve());
    expect(screen.getByText("检查完成，当前版本继续运行")).toBeInTheDocument();
  });

  it("makes stalled preparation retryable without calling it complete", async () => {
    vi.useFakeTimers();
    start();
    await act(async () => { install(); });
    act(() => vi.advanceTimersByTime(120000));
    expect(screen.getByText("更新准备仍未完成，请联网后重试；当前版本仍可使用")).toBeInTheDocument();
    await act(async () => { await controller.check(); });
    expect(screen.getByText("正在准备更新…，可以继续使用")).toBeInTheDocument();
  });

  it("fences a timed out check so its late failure cannot replace a newer result", async () => {
    vi.useFakeTimers();
    const pending = deferred(); update.mockReturnValueOnce(pending.promise);
    start();
    act(() => vi.advanceTimersByTime(30000));
    expect(screen.getByRole("button", { name: "重试检查更新" })).toBeEnabled();
    await act(async () => { await controller.check(); });
    await act(async () => pending.reject(new Error("old network error")));
    expect(screen.getByText("检查完成，当前版本继续运行")).toBeInTheDocument();
  });

  it("ignores callbacks from a disposed registration lifetime", async () => {
    const pending = deferred(); update.mockReturnValueOnce(pending.promise);
    start();
    let old!: ServiceWorker;
    act(() => { old = install(); controller.dispose(); });
    controller = new UpdateController(registration, false, vi.fn(), requested);
    Object.assign(registration, { installing: null, waiting: worker() });
    await act(async () => { controller.start(); });
    await act(async () => { pending.resolve(); state(old, "redundant"); });
    expect(screen.getByText("更新已准备好")).toBeInTheDocument();
  });

  it("does not overwrite an active handover with a late check or an install event", async () => {
    const pending = deferred(); update.mockReturnValueOnce(pending.promise);
    Object.assign(registration, { waiting: worker() });
    vi.stubGlobal("MessageChannel", class { port1 = { close: vi.fn() }; port2 = {}; });
    start();
    act(() => controller.apply());
    await act(async () => { pending.resolve(); install(); });
    expect(screen.getByRole("button", { name: "更新中…" })).toBeDisabled();
    expect(requested).toHaveBeenLastCalledWith(true);
  });

  it("reports a lost waiting worker instead of silently ignoring apply", async () => {
    Object.assign(registration, { waiting: worker() });
    start(); await act(async () => {});
    Object.assign(registration, { waiting: null });
    act(() => controller.apply());
    expect(screen.getByText("已准备的更新暂不可用，请重新检查更新")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试检查更新" })).toBeEnabled();
  });

  it("keeps blocked guidance on foreground and ignores a prior port after a retry", async () => {
    const ports: { onmessage?: (event: MessageEvent) => void; close: () => void }[] = [];
    vi.stubGlobal("MessageChannel", class {
      port1 = { close: vi.fn() }; port2 = {};
      constructor() { ports.push(this.port1); }
    });
    Object.assign(registration, { waiting: worker() });
    start(); await act(async () => {});
    act(() => { controller.apply(); ports[0].onmessage?.(new MessageEvent("message", { data: { safe: false } })); });
    expect(screen.getByText(/请先在其他合谱窗口完成操作/)).toBeInTheDocument();
    act(() => controller.foregroundCheck());
    expect(screen.getByText(/请先在其他合谱窗口完成操作/)).toBeInTheDocument();
    act(() => {
      controller.apply();
      ports[0].onmessage?.(new MessageEvent("message", { data: { safe: false } }));
      ports[1].onmessage?.(new MessageEvent("message", { data: { safe: true } }));
    });
    expect(screen.getByText("正在应用更新…")).toBeInTheDocument();
  });

  it("distinguishes unavailable shell resources from another window veto", async () => {
    let port!: { onmessage?: (event: MessageEvent) => void; close: () => void };
    vi.stubGlobal("MessageChannel", class {
      port1 = { close: vi.fn() }; port2 = {};
      constructor() { port = this.port1; }
    });
    Object.assign(registration, { waiting: worker() });
    start(); await act(async () => {});
    act(() => { controller.apply(); port.onmessage?.(new MessageEvent("message", { data: { safe: false, reason: "incomplete" } })); });
    expect(screen.getByText("更新资源暂不可用，请联网后重试")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新加载并更新" })).toBeEnabled();
  });

  it("reports a handover timeout and ignores its late acknowledgment", async () => {
    vi.useFakeTimers();
    let port!: { onmessage?: (event: MessageEvent) => void; close: () => void };
    vi.stubGlobal("MessageChannel", class {
      port1 = { close: vi.fn() }; port2 = {};
      constructor() { port = this.port1; }
    });
    Object.assign(registration, { waiting: worker() });
    start(); await act(async () => {});
    act(() => { controller.apply(); vi.advanceTimersByTime(10000); });
    expect(screen.getByText("更新未完成，请检查其他合谱窗口后重试")).toBeInTheDocument();
    expect(requested).toHaveBeenLastCalledWith(false);
    act(() => port.onmessage?.(new MessageEvent("message", { data: { safe: true } })));
    expect(screen.getByRole("button", { name: "重新加载并更新" })).toBeEnabled();
  });

  it("exposes registration timeout and retries registration rather than claiming there is no update", () => {
    vi.useFakeTimers(); controller.dispose();
    const retry = vi.fn();
    controller = new UpdateController(undefined, false, retry, requested);
    start();
    expect(screen.getByRole("button", { name: "准备中…" })).toBeDisabled();
    act(() => vi.advanceTimersByTime(30000));
    act(() => { void controller.check(); });
    expect(retry).toHaveBeenCalledOnce();
  });

  it("reports offline startup without a registration and can retry after reconnecting", () => {
    controller.dispose();
    const retry = vi.fn();
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    controller = new UpdateController(undefined, false, retry, requested);
    start();
    expect(screen.getByText("当前离线，联网后可重试；当前版本仍可使用")).toBeInTheDocument();
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    act(() => { void controller.check(); });
    expect(retry).toHaveBeenCalledOnce();
  });

  it("honestly reports unsupported browsers", () => {
    Reflect.deleteProperty(navigator, "serviceWorker");
    start();
    expect(screen.getByText("当前浏览器不支持应用内更新，请关闭页面后重新打开")).toBeInTheDocument();
    expect(screen.getByRole("button")).toBeDisabled();
  });
});
