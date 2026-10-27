import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { ConnectionControl } from './connection-control';
import { connections } from './connection';

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
