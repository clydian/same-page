import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { ConnectionControl } from './connection-control';
import { connections } from './connection';
import { IdentityNotice } from '../auth/local-entry';
import type { ApplicationIdentity } from '../auth/application-identity';

vi.mock('./connection', async () => {
  const { ConnectionController } = await import('./controller');
  const origins = { direct: 'https://app.test', backup: 'https://alt.test' };
  return { connectionsEnabled: true, connectionWebsites: origins,
    connections: new ConnectionController({ origins, pageOrigin: origins.direct, now: () => Date.now(),
      send: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args) }),
    setConnectionMode: vi.fn() };
});
vi.mock('../auth/auth-client', () => ({ authClient: { useSession: () => ({ data: { user: { id: 'local-user' } }, refetch: vi.fn(), isRefetching: false }) } }));

it('keeps open-panel text subscribed to attempted, confirmed and failed business routes with accessible sample details', async () => {
  const resolveBackup: ((value: Response) => void)[] = [];
  let failDirect = false, failBackup = false;
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async input => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith('/health')) return Response.json({ status: 'ok' });
    if (path.endsWith('/status')) return Response.json({ sessionId: null });
    if (path.includes('/direct/') && failDirect || path.includes('/backup/') && failBackup) throw new TypeError('offline');
    return new Promise(resolve => { resolveBackup.push(resolve); });
  }));
  render(<MemoryRouter initialEntries={['/login']}><ConnectionControl /></MemoryRouter>);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^连接线路/ })); });
  await screen.findByText('当前线路：直连');
  expect(screen.queryByRole('button', { name: '重新检测' })).not.toBeInTheDocument();
  const details = screen.getByLabelText(/^直连检测详情/);
  expect(details.tagName).toBe('SUMMARY');
  expect(details).toHaveAccessibleName(/1 次采样/);
  failDirect = true;
  let requests!: Promise<Response>[];
  await act(async () => { requests = [connections.fetch('/api/choirs/a'), connections.fetch('/api/choirs/b')]; });
  expect(screen.getByRole('status')).toHaveTextContent('正在尝试备用…');
  await waitFor(() => expect(resolveBackup).toHaveLength(2));
  await act(async () => { resolveBackup[0](Response.json({ ok: true })); await requests[0]; });
  expect(screen.getByRole('status')).toHaveTextContent('当前线路：备用');
  expect(screen.getByRole('status')).not.toHaveTextContent('正在尝试');
  await act(async () => { resolveBackup[1](Response.json({ ok: true })); await requests[1]; });
  failBackup = true;
  await act(async () => { await connections.fetch('/api/choirs').catch(() => {}); });
  expect(screen.getByRole('status')).toHaveTextContent('当前线路：备用（暂时连不上）');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '关闭连接面板' })); });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  vi.unstubAllGlobals();
});

it('shows newer evidence, conservatively resolves ties and expires old evidence without changing pinned routing', async () => {
  const base = Date.now() + 1_000_000;
  vi.useFakeTimers(); vi.setSystemTime(base);
  let businessFails = false, probeFails = false;
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async input => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith('/status')) return Response.json({ sessionId: null });
    if (path.endsWith('/health')) {
      if (probeFails) throw new TypeError('probe offline');
      return Response.json({ status: 'ok' });
    }
    if (businessFails) throw new TypeError('business offline');
    return Response.json({ ok: true });
  }));
  try {
    connections.setMode('backup');
    await connections.check();
    render(<MemoryRouter initialEntries={['/login']}><ConnectionControl /></MemoryRouter>);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^连接线路/ })); });
    const current = () => screen.getByText(/^当前线路：/);
    expect(current()).toHaveTextContent('当前线路：备用');
    businessFails = true; vi.setSystemTime(base + 1000);
    await act(async () => { await connections.fetch('/api/choirs').catch(() => {}); });
    expect(current()).toHaveTextContent('暂时连不上');
    // Route rows retain the last health sample; current-route evidence also
    // includes the newer failed business request.
    expect(screen.getAllByText('线路可达', { selector: '.connection-health' })).toHaveLength(2);
    vi.setSystemTime(base + 2000);
    await act(async () => { await connections.sample(new AbortController().signal); });
    expect(current()).toHaveTextContent('当前线路：备用');
    expect(current()).not.toHaveTextContent('暂时连不上');
    expect(connections.getSnapshot().health.backup.state).toBe('unreachable');
    vi.setSystemTime(base + 3000);
    await act(async () => { await connections.fetch('/api/choirs').catch(() => {}); });
    expect(current()).toHaveTextContent('暂时连不上');
    // At the exact same timestamp the fresh successful sample cannot conceal failure.
    await act(async () => { await connections.sample(new AbortController().signal); });
    expect(current()).toHaveTextContent('暂时连不上');
    businessFails = false; probeFails = true; vi.setSystemTime(base + 4000);
    await act(async () => { await connections.sample(new AbortController().signal); });
    await act(async () => { await connections.fetch('/api/choirs'); });
    expect(current()).toHaveTextContent('暂时连不上');
    // The one-second presentation clock advances; the ten-second probe isn't due.
    vi.setSystemTime(base + 50_000);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(current()).toHaveTextContent('当前线路：备用（待检测）');
    expect(screen.getAllByText('结果已过期')).toHaveLength(2);
    expect(connections.getSnapshot()).toMatchObject({ mode: 'backup', active: 'backup' });
  } finally { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); }
});

it('keeps identity failure visible when health succeeds and the browser reports offline', async () => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async input => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith('/health')) return Response.json({ status: 'ok' });
    if (path.endsWith('/status')) throw new TypeError('session unavailable');
    throw new Error(`unexpected request: ${path}`);
  }));
  connections.invalidateIdentity();
  connections.setMode('direct');
  const identity = { onlineState: 'unreachable', localUserId: 'local-user',
    session: { refetch: vi.fn(), isRefetching: false } } as unknown as ApplicationIdentity;
  try {
    render(<MemoryRouter initialEntries={['/drives']}>
      <IdentityNotice identity={identity} />
      <ConnectionControl />
    </MemoryRouter>);
    expect(screen.getByRole('button', { name: /连接线路，浏览器离线/ })).toBeVisible();
    expect(screen.getByRole('button', { name: /连接线路，浏览器离线/ })).toHaveTextContent(/^$/);
    // The connection entry must not replace an independent session failure notice.
    expect(screen.getByText(/暂时无法连接，已保存的内容仍然保留/)).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^连接线路/ })); });
    await screen.findByText('当前线路：直连（浏览器离线）');
    expect(screen.getAllByText('线路可达', { selector: '.connection-health' })).toHaveLength(2);
    const explanation = screen.getByText(/线路检测只确认服务能否响应/);
    expect(explanation).not.toBeVisible();
    fireEvent.click(screen.getByText('状态与连接帮助', { exact: true }));
    expect(explanation).toBeVisible();
    expect(screen.getByText(/浏览器报告离线，部分联网操作暂停/)).toBeVisible();
    expect(connections.getSnapshot().identity.direct).toBe('unprepared');
  } finally { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); }
});
