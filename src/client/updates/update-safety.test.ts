import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { canAcceptUpdate, canApplyUpdate, holdUpdate, noteUpdateInteraction, setUpdateRoute } from './update-safety';

beforeEach(() => {
  vi.useFakeTimers({ now: 0 });
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  setUpdateRoute('/about');
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it.each([0, Date.UTC(2026, 9, 28)])('requires a full idle second using one clock, starting at %s', now => {
  vi.setSystemTime(now);
  noteUpdateInteraction();
  expect(canApplyUpdate()).toBe(false);
  vi.advanceTimersByTime(999);
  expect(canApplyUpdate()).toBe(false);
  vi.advanceTimersByTime(1);
  expect(canApplyUpdate()).toBe(true);
  noteUpdateInteraction();
  expect(canApplyUpdate()).toBe(false);
  vi.advanceTimersByTime(999);
  expect(canApplyUpdate()).toBe(false);
  vi.advanceTimersByTime(1);
  expect(canApplyUpdate()).toBe(true);
});

it('manual requests bypass idle time but keep task and hidden-page safety', () => {
  expect(canApplyUpdate(true)).toBe(true);
  const release = holdUpdate();
  try { expect(canApplyUpdate(true)).toBe(false); }
  finally { release(); }
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  expect(canApplyUpdate(true)).toBe(false);
  expect(canAcceptUpdate(true)).toBe(true);
});
