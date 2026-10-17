import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { usePracticeFocus } from './use-practice-focus';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
beforeEach(() => { vi.stubGlobal('innerWidth', 390); vi.stubGlobal('innerHeight', 844); });
function fullscreen(enter = vi.fn().mockResolvedValue(undefined), exit = vi.fn().mockResolvedValue(undefined)) {
  Object.defineProperty(document.documentElement, 'requestFullscreen', { configurable: true, value: enter });
  Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true });
  Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exit });
  return { enter, exit };
}
afterEach(() => {
  Reflect.deleteProperty(document.documentElement, 'requestFullscreen');
  for (const key of ['fullscreenEnabled', 'fullscreenElement', 'exitFullscreen']) Reflect.deleteProperty(document, key);
});
it('starts collapsed in landscape and preserves an explicit choice through rotation', () => {
  vi.stubGlobal('innerHeight', 360); vi.stubGlobal('innerWidth', 1000);
  const { result, rerender } = renderHook(() => usePracticeFocus());
  expect(result.current.bottomCollapsed).toBe(true);
  act(() => result.current.setBottomCollapsed(false));
  vi.stubGlobal('innerHeight', 844); vi.stubGlobal('innerWidth', 390);
  act(() => window.dispatchEvent(new Event('resize'))); rerender();
  expect(result.current.bottomCollapsed).toBe(false);
});
it('starts expanded in portrait and keeps embedded review controls expanded', () => {
  vi.stubGlobal('innerHeight', 844);
  const normal = renderHook(() => usePracticeFocus());
  expect(normal.result.current.bottomCollapsed).toBe(false);
  vi.stubGlobal('innerHeight', 320);
  const embedded = renderHook(() => usePracticeFocus(true));
  expect(embedded.result.current.bottomCollapsed).toBe(false);
});
it('requests fullscreen from the action and restores control choices on browser exit', async () => {
  const { enter } = fullscreen();
  const { result } = renderHook(() => usePracticeFocus());
  act(() => result.current.setBottomCollapsed(true));
  await act(() => result.current.enter());
  expect(enter).toHaveBeenCalledExactlyOnceWith({ navigationUI: 'hide' });
  expect(result.current.focused).toBe(true);
  act(() => document.dispatchEvent(new Event('fullscreenchange')));
  expect(result.current.focused).toBe(false);
  expect(result.current.bottomCollapsed).toBe(true);
});
it('keeps a discoverable focus fallback when unsupported or fullscreen rejects', async () => {
  const { result } = renderHook(() => usePracticeFocus());
  await act(() => result.current.enter());
  expect(result.current.notice).toContain('系统状态栏'); expect(result.current.focused).toBe(true);
  await act(() => result.current.exit()); expect(result.current.focused).toBe(false);
  fullscreen(vi.fn().mockRejectedValue(new Error('denied')));
  const rejected = renderHook(() => usePracticeFocus());
  await act(() => rejected.result.current.enter());
  expect(rejected.result.current.notice).toContain('全屏未能开启');
  await act(() => rejected.result.current.exit());
  expect(rejected.result.current.bottomCollapsed).toBe(false);
});
it('reports exit failure without hiding the exit control', async () => {
  const { exit } = fullscreen(undefined, vi.fn().mockRejectedValue(new Error('denied')));
  const { result } = renderHook(() => usePracticeFocus());
  await act(() => result.current.enter());
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: document.documentElement });
  await act(() => result.current.exit());
  expect(exit).toHaveBeenCalledOnce(); expect(result.current.focused).toBe(true);
  expect(result.current.notice).toContain('无法退出全屏');
});

it('retains a manual choice made during focus when focus exits', async () => {
  const { result } = renderHook(() => usePracticeFocus());
  await act(() => result.current.enter());
  expect(result.current.bottomCollapsed).toBe(true);
  act(() => result.current.setBottomCollapsed(false));
  await act(() => result.current.exit());
  expect(result.current.bottomCollapsed).toBe(false);
});
