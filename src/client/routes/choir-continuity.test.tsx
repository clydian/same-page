import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import LeaveDrivePage from './leave-drive-page';
import { LocalIdentityObserver } from '../platform/local-identity-observer';
import { activateAuthenticatedLocalOwner } from '../platform/local-workspace';
import { observeNavigationSession } from '../settings/navigation-events';
import { localDatabase } from '../platform/local-database';
const state = vi.hoisted(() => ({ pending: false, sessionId: "session", dataMissing: false, error: null as { status: number } | null }));
vi.mock('../auth/auth-client', () => ({ authClient: { useSession: () => ({ data: state.dataMissing ? null : { user: { id: 'user', email: 'user@example.test' }, session: { id: state.sessionId } }, isPending: state.pending, isRefetching: false, error: state.error }) } }));
beforeEach(async () => { await localDatabase.open(); observeNavigationSession(null); });
afterEach(() => { state.error = null; state.pending = false; state.sessionId = "session"; state.dataMissing = false; vi.unstubAllGlobals(); });
it.each(['temporary', 'missing-data', 'signed-out', 'new-session'] as const)('keeps input through a temporary failure and clears it at a %s boundary', async boundary => {
  await activateAuthenticatedLocalOwner('user');
  observeNavigationSession('user:session', 'user');
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/settings')
    ? Response.json({ name: '排练云盘', nameRevision: 1, displayName: '小花', membershipRevision: 1, canEditDriveInfo: false })
    : String(input).endsWith('/lifecycle') ? Response.json({ userId: 'user', reauthenticated: false, methods: [], deletion: null, memberships: [{ id: 'membership', choirId: 'drive', name: '排练云盘', displayName: '小花', isPreviewEntry: 0, isOwner: 0, status: 'active', revision: 1, removedAt: null }] }) : new Response(null, { status: 404 })));
  const tree = () => <MemoryRouter initialEntries={['/choirs/drive/me']}><LocalIdentityObserver /><Routes><Route path="/choirs/:choirId/me" element={<LeaveDrivePage />} /></Routes></MemoryRouter>;
  const view = render(tree());
  fireEvent.click(await screen.findByRole('button', { name: '修改显示名' }));
  const input = await screen.findByRole('textbox', { name: '我在此云盘的显示名' });
  fireEvent.change(input, { target: { value: '尚未保存的名字' } });
  expect(input).toHaveValue('尚未保存的名字');
  state.error = { status: 503 };
  state.dataMissing = boundary === 'missing-data';
  view.rerender(tree());
  await waitFor(() => expect(screen.getByRole('button', { name: '保存' })).toBeDisabled());
  expect(screen.getByRole('textbox', { name: '我在此云盘的显示名' })).toBe(input);
  expect(input).toHaveValue('尚未保存的名字');
  state.error = null; state.dataMissing = false;
  view.rerender(tree());
  const reopened = await screen.findByRole('textbox', { name: '我在此云盘的显示名' });
  await waitFor(() => expect(screen.getByRole('button', { name: '保存' })).toBeEnabled());
  expect(reopened).toBe(input);
  expect(reopened).toHaveValue('尚未保存的名字');
  if (boundary === 'signed-out' || boundary === 'new-session') {
    if (boundary === 'signed-out') state.error = { status: 401 };
    else state.sessionId = 'another-session';
    view.rerender(tree());
    await waitFor(() => expect(screen.queryByRole('textbox', { name: '我在此云盘的显示名' })).not.toBeInTheDocument());
    state.error = null;
    view.rerender(tree());
    await screen.findByRole('button', { name: '修改显示名' });
    expect(screen.queryByRole('textbox', { name: '我在此云盘的显示名' })).not.toBeInTheDocument();
  }
});
