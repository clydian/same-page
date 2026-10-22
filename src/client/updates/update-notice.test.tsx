import { act, fireEvent, render, screen } from '@testing-library/react';
import { Link, MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { UpdateNotice } from './update-notice';
import { holdUpdate, setUpdateRoute } from './update-safety';
import { setUpdateStatus } from './update-status';

const worker = () => new EventTarget() as ServiceWorker;
function Navigation() {
  const { pathname } = useLocation();
  setUpdateRoute(pathname);
  return <><Link to="/choirs/drive">文件库</Link><Link to="/about">其他页面</Link><UpdateNotice /></>;
}
function mount(path = '/choirs/drive') {
  setUpdateRoute(path);
  return render(<MemoryRouter initialEntries={[path]}><UpdateNotice /></MemoryRouter>);
}
function advance(ms: number) { act(() => vi.advanceTimersByTime(ms)); }
beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  setUpdateStatus({ phase: 'ready', message: '更新已准备好', deferred: { worker: worker(), since: Date.now() } });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it('waits before politely reminding once, dismisses after eight seconds and does not repeat on retries', () => {
  const waiting = worker(), since = Date.now();
  setUpdateStatus({ phase: 'ready', message: '更新已准备好', deferred: { worker: waiting, since } });
  mount();
  advance(9999);expect(screen.queryByRole('complementary')).toBeNull();
  advance(501);
  expect(screen.getByRole('status')).toHaveTextContent('请先完成其他合谱窗口中的操作，或关闭它们。');
  expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  expect(screen.getByRole('link', { name: '查看更新' })).toHaveAttribute('href', '/about');
  expect(document.activeElement).toBe(document.body);
  advance(8000);expect(screen.queryByRole('complementary')).toBeNull();
  act(() => setUpdateStatus({ phase: 'applying', message: '正在确认', deferred: { worker: waiting, since } }));
  act(() => setUpdateStatus({ phase: 'ready', message: '更新已准备好', deferred: { worker: waiting, since } }));
  advance(30000);expect(screen.queryByRole('complementary')).toBeNull();
});

it.each(['/drives', '/about', '/choirs/drive/scores/score', '/choirs/drive/settings'])('never reminds on %s', path => {
  mount(path);advance(30000);expect(screen.queryByRole('complementary')).toBeNull();
});

it('waits while an operation or hidden page prevents a quiet library reminder', () => {
  const release = holdUpdate();
  mount();advance(15000);expect(screen.queryByRole('complementary')).toBeNull();
  release();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  advance(5000);expect(screen.queryByRole('complementary')).toBeNull();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  advance(500);expect(screen.getByRole('complementary')).toBeVisible();
  act(() => setUpdateStatus({ phase: 'applying', message: '正在应用更新' }));
  expect(screen.queryByRole('complementary')).toBeNull();
});

it('pauses dismissal while hovered or focused and supports an explicit close', () => {
  mount();advance(10500);
  const notice = screen.getByRole('complementary');
  fireEvent.mouseEnter(notice);advance(20000);expect(notice).toBeVisible();
  fireEvent.focus(screen.getByRole('link', { name: '查看更新' }));
  fireEvent.mouseLeave(notice);advance(20000);expect(notice).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '关闭更新提醒' }));
  advance(30000);expect(screen.queryByRole('complementary')).toBeNull();
});

it('does not repeat after navigating away and back but can remind for another version', () => {
  render(<MemoryRouter initialEntries={['/choirs/drive']}><Navigation /></MemoryRouter>);
  advance(10500);expect(screen.getByRole('complementary')).toBeVisible();
  fireEvent.click(screen.getByRole('link', { name: '其他页面' }));
  advance(1000);
  fireEvent.click(screen.getByRole('link', { name: '文件库' }));
  advance(5000);expect(screen.queryByRole('complementary')).toBeNull();
  act(() => setUpdateStatus({ phase: 'ready', message: '更新已准备好', deferred: { worker: worker(), since: Date.now() } }));
  advance(10500);expect(screen.getByRole('complementary')).toBeVisible();
});
