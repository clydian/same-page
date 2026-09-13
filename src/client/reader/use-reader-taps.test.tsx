import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useReaderTaps } from "./use-reader-taps";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
function setup() {
  const onSingle = vi.fn(), onDouble = vi.fn();
  const hook = renderHook(({ revision }) => useReaderTaps({ disabled: false, revision, onSingle, onDouble }), { initialProps: { revision: "first" } });
  const down = (x = 100) => act(() => hook.result.current.down({ x, y: 100 }));
  const up = (x = 100) => act(() => hook.result.current.up({ x, y: 100 }));
  const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));
  return { ...hook, onSingle, onDouble, down, up, wait };
}
it("waits 250ms after release, while second down suspends the pending single", () => {
  const t = setup();
  t.down(); t.up(); t.wait(249);
  expect(t.onSingle).not.toHaveBeenCalled();
  t.down(124); t.wait(300); t.up(124); t.wait(500);
  expect(t.onDouble).toHaveBeenCalledExactlyOnceWith({ x: 124, y: 100 });
  expect(t.onSingle).not.toHaveBeenCalled();
  t.down(); t.up(); t.wait(250);
  expect(t.onSingle).toHaveBeenCalledTimes(1);
});
it("a distant second contact replaces the pending single with its own sequence", () => {
  const t = setup();
  t.down(); t.up(); t.wait(100); t.down(125); t.up(125); t.wait(250);
  expect(t.onSingle).toHaveBeenCalledExactlyOnceWith({ x: 125, y: 100 });
  expect(t.onDouble).not.toHaveBeenCalled();
});
it.each([10, 20])("movement of %i pixels cancels even when the finger returns", distance => {
  const t = setup();
  t.down(); t.up(); t.down();
  act(() => t.result.current.move({ x: 100 + distance, y: 100 }));
  t.up(); t.wait(1000);
  expect(t.onSingle).not.toHaveBeenCalled(); expect(t.onDouble).not.toHaveBeenCalled();
});
it("accepts a 500ms press but rejects a longer second press", () => {
  const t = setup();
  t.down(); t.wait(500); t.up(); t.wait(250);
  expect(t.onSingle).toHaveBeenCalledTimes(1);
  t.down(); t.up(); t.down(); t.wait(501); t.up(); t.wait(1000);
  expect(t.onSingle).toHaveBeenCalledTimes(1); expect(t.onDouble).not.toHaveBeenCalled();
});
it("treats the third tap as a new single and cancels stale context intent", () => {
  const t = setup();
  t.down(); t.up(); t.down(); t.up(); t.down(); t.up(); t.wait(250);
  expect(t.onDouble).toHaveBeenCalledTimes(1); expect(t.onSingle).toHaveBeenCalledTimes(1);
  t.down(); t.up(); t.rerender({ revision: "next" }); t.wait(250);
  expect(t.onSingle).toHaveBeenCalledTimes(1);
});
