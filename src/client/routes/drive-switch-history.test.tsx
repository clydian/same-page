import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { AppRoutes } from '../app';
import { authClient } from '../auth/auth-client';
import { effectiveCapabilities, emptyPermissions } from '../../shared/drive-permissions';
import { localDatabase } from '../platform/local-database';
import { activateAuthenticatedLocalOwner } from '../platform/local-workspace';

vi.mock('../auth/auth-client', () => ({ authClient: { useSession: vi.fn(), signOut: vi.fn(), signIn: { email: vi.fn(), social: vi.fn() } } }));
it('switching from A to B should not make system back reopen A', async () => {
  await localDatabase.open();
  await activateAuthenticatedLocalOwner('singer');
  vi.mocked(authClient.useSession).mockReturnValue({ data: { user: { id: 'singer', email: 'singer@example.test' }, session: { id: 'session' } }, isPending: false } as ReturnType<typeof authClient.useSession>);
  const choir = (id: string) => ({ id, name: id === 'a' ? '爱情' : 'PPOE', guestAdmissionMode: 'invite' });
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path === '/api/choirs') return Response.json({ memberships: ['a','b'].map(id => ({ id: 'm-'+id, displayName: '歌者', isOwner: true, choir: choir(id) })) });
    if (path.endsWith('/bootstrap')) return Response.json({ choir: choir(path.split('/')[3]), scores: [], storage: { usedBytes: 0, limitBytes: 1000 }, permissions: { access: 'membership', capabilities: effectiveCapabilities(true, emptyPermissions(), emptyPermissions()) } });
    return new Response(null, { status: 404 });
  }));
  const router = createMemoryRouter([{ path: '*', element: <AppRoutes /> }], { initialEntries: ['/privacy', '/choirs/a'], initialIndex: 1 });
  render(<RouterProvider router={router} />);
  fireEvent.click(await screen.findByRole('button', { name: '切换云盘：爱情' }));
  fireEvent.click(await screen.findByRole('link', { name: /PPOE.*拥有者/ }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/choirs/b'));
  expect(router.state.historyAction).toBe('REPLACE');
  await screen.findByRole('heading', { name: 'PPOE' });
  await act(() => router.navigate(-1));
  expect(router.state.location.pathname).not.toBe('/choirs/a');
});
