import { act, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { ReloadPrompt } from '../components/reload-prompt';

// Exercise the actual DOM event subscriptions, registration retries and timers.
// Controller tests cover the worker protocol and handover safety separately.
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('checks after reconnection, coalesces lifecycle events and removes listeners on unmount', async () => {
  vi.useFakeTimers();
  const update = vi.fn(async () => {});
  const registration = Object.assign(new EventTarget(), { update, installing: null, waiting: null });
  const workers = Object.assign(new EventTarget(), { register: vi.fn(async () => registration), controller: null });
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: workers });
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  const view = render(<MemoryRouter><ReloadPrompt /></MemoryRouter>);
  await act(async () => {});
  expect(update).toHaveBeenCalledTimes(1);
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
  await act(async () => { vi.advanceTimersByTime(60000); });
  expect(update).toHaveBeenCalledTimes(1);
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  await act(async () => {
    window.dispatchEvent(new Event('online'));
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('online'));
  });
  expect(update).toHaveBeenCalledTimes(2);
  view.unmount();
  await act(async () => {
    vi.advanceTimersByTime(30 * 60000);
    window.dispatchEvent(new Event('online'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(update).toHaveBeenCalledTimes(2);
});

it('retains exponential backoff across real registration remounts and then checks a successful registration', async () => {
  vi.useFakeTimers();
  const update = vi.fn(async () => {});
  const registration = Object.assign(new EventTarget(), { update, installing: null, waiting: null });
  const register = vi.fn().mockRejectedValueOnce(new TypeError('offline entry')).mockRejectedValueOnce(new TypeError('offline entry')).mockResolvedValue(registration);
  const workers = Object.assign(new EventTarget(), { register, controller: null });
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: workers });
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  const view = render(<MemoryRouter><ReloadPrompt /></MemoryRouter>);
  await act(async () => {});
  expect(register).toHaveBeenCalledTimes(1);
  await act(async () => { vi.advanceTimersByTime(30000); });
  expect(register).toHaveBeenCalledTimes(2);
  await act(async () => { vi.advanceTimersByTime(59000); window.dispatchEvent(new Event('online')); });
  expect(register).toHaveBeenCalledTimes(2);
  await act(async () => { vi.advanceTimersByTime(1000); });
  expect(register).toHaveBeenCalledTimes(3);
  expect(update).toHaveBeenCalledTimes(1);
  view.unmount();
});

it('hands over at one idle second after the last DOM interaction', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('MessageChannel', class { port1 = { close: vi.fn() }; port2 = {}; });
  const waiting = Object.assign(new EventTarget(), { state: 'installed', postMessage: vi.fn() });
  const registration = Object.assign(new EventTarget(), { update: vi.fn(async () => {}), installing: null, waiting });
  const workers = Object.assign(new EventTarget(), { register: vi.fn(async () => registration), controller: null });
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: workers });
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  const view = render(<MemoryRouter><ReloadPrompt /></MemoryRouter>);
  await act(async () => {});
  act(() => { vi.advanceTimersByTime(500); document.dispatchEvent(new Event('pointerdown')); });
  act(() => { vi.advanceTimersByTime(999); });
  expect(waiting.postMessage).not.toHaveBeenCalled();
  act(() => { vi.advanceTimersByTime(1); });
  expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SAME_PAGE_SAFE_UPDATE', requested: true, automatic: true }, expect.any(Array));
  view.unmount();
});
