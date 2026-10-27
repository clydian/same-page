import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { ConnectionControl } from './connection-control';
import { connections } from './connection';

vi.mock('./connection', async () => {
  const { ConnectionController } = await import('./controller');
  const origins = { direct: 'https://app.test', backup: 'https://alt.test' };
  return { connectionsEnabled: true, connectionWebsites: origins,
    connections: new ConnectionController({ origins, pageOrigin: origins.direct,
      send: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args) }),
    setConnectionMode: vi.fn() };
});
vi.mock('../auth/auth-client', () => ({ authClient: { useSession: () => ({ data: { user: { id: 'local-user' } }, refetch: vi.fn(), isRefetching: false }) } }));

it('keeps open-panel text subscribed to attempted, confirmed and failed business routes with accessible sample details', async () => {
  let resolveBackup!: (value: Response) => void;
  let failDirect = false, failBackup = false;
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async input => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith('/health')) return Response.json({ status: 'ok' });
    if (path.endsWith('/status')) return Response.json({ sessionId: null });
    if (path.includes('/direct/') && failDirect || path.includes('/backup/') && failBackup) throw new TypeError('offline');
    return new Promise(resolve => { resolveBackup = resolve; });
  }));
  render(<MemoryRouter initialEntries={['/login']}><ConnectionControl /></MemoryRouter>);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^连接线路/ })); });
  await screen.findByText('当前线路：直连');
  expect(screen.queryByRole('button', { name: '重新检测' })).not.toBeInTheDocument();
  const details = screen.getByLabelText(/^直连检测详情/);
  expect(details.tagName).toBe('SUMMARY');
  expect(details).toHaveAccessibleName(/1 次采样/);
  failDirect = true;
  let request!: Promise<Response>;
  await act(async () => { request = connections.fetch('/api/choirs'); });
  expect(screen.getByRole('status')).toHaveTextContent('正在尝试备用…');
  await waitFor(() => expect(resolveBackup).toBeTypeOf('function'));
  await act(async () => { resolveBackup(Response.json({ ok: true })); await request; });
  expect(screen.getByRole('status')).toHaveTextContent('当前线路：备用');
  failBackup = true;
  await act(async () => { await connections.fetch('/api/choirs').catch(() => {}); });
  expect(screen.getByRole('status')).toHaveTextContent('当前线路：备用（暂时连不上）');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '关闭连接面板' })); });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  vi.unstubAllGlobals();
});
