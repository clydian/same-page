import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { recoverSession, useSessionRecovery } from "./session-recovery";
import type { OnlineIdentityState } from "./application-identity";

const session = vi.hoisted(() => ({ isRefetching: false, refetch: vi.fn<() => Promise<void>>() }));
vi.mock("./auth-client", () => ({ authClient: { $store: { atoms: { session: { get: () => session } } } } }));
beforeEach(() => { vi.useFakeTimers(); session.isRefetching = false; session.refetch.mockReset().mockResolvedValue(undefined); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it("bounds a foreground failure episode and shares manual concurrent retries", async () => {
  const { rerender } = renderHook(({ busy }) => useSessionRecovery("unreachable", busy, 503), { initialProps: { busy: false } });
  for (let attempt = 0; attempt < 3; attempt++) {
    await act(() => vi.advanceTimersByTimeAsync(15_000));
    expect(session.refetch).toHaveBeenCalledTimes(attempt + 1);
    rerender({ busy: true });
    rerender({ busy: false });
  }
  await act(() => vi.advanceTimersByTimeAsync(120_000));
  expect(session.refetch).toHaveBeenCalledTimes(3);
  let finish!: () => void;
  session.refetch.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
  const manual = recoverSession();
  expect(recoverSession()).toBe(manual);
  expect(session.refetch).toHaveBeenCalledTimes(4);
  finish(); await manual;
});

it("suspends retries offline or hidden and cancels the timer when identity settles", async () => {
  const visible = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  const { rerender, unmount } = renderHook(({ state }: { state: OnlineIdentityState }) => useSessionRecovery(state, false), { initialProps: { state: "unreachable" } });
  await act(() => vi.advanceTimersByTimeAsync(30_000));
  expect(session.refetch).not.toHaveBeenCalled();
  visible.mockReturnValue("visible"); online.mockReturnValue(false);
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  await act(() => vi.advanceTimersByTimeAsync(30_000));
  expect(session.refetch).not.toHaveBeenCalled();
  online.mockReturnValue(true);
  act(() => window.dispatchEvent(new Event("online")));
  rerender({ state: "signed-out" });
  await act(() => vi.advanceTimersByTimeAsync(30_000));
  expect(session.refetch).not.toHaveBeenCalled();
  rerender({ state: "unreachable" }); unmount();
  await act(() => vi.advanceTimersByTimeAsync(30_000));
  expect(session.refetch).not.toHaveBeenCalled();
});

it.each(["signed-out", "local-unavailable"] as const)("does not automatically retry %s", async state => {
  renderHook(() => useSessionRecovery(state, false));
  act(() => window.dispatchEvent(new Event("online")));
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  await act(() => vi.advanceTimersByTimeAsync(120_000));
  expect(session.refetch).not.toHaveBeenCalled();
});
