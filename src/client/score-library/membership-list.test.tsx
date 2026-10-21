import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { MembershipList } from './membership-list';
import { observeNavigationResponse } from '../settings/navigation-events';
import { localDatabase } from '../platform/local-database';
import { activateAuthenticatedLocalOwner, authenticatedLocalOwnerKey } from '../platform/local-workspace';
import { effectiveCapabilities, emptyPermissions } from '../../shared/drive-permissions';

async function setup() {
  await localDatabase.open();
  await activateAuthenticatedLocalOwner('singer');
  for (const [id, name, isOwner] of [['a', '爱情', false], ['b', 'PPOE', true]] as const) {
    await localDatabase.driveDirectories.put({ key: id, ownerKey: authenticatedLocalOwnerKey('singer'), choirId: id, choir: { id, name, guestAdmissionMode: 'invite' }, scores: [], membership: true, capabilities: effectiveCapabilities(isOwner, emptyPermissions(), emptyPermissions()) });
  }
  let finish!: (r: Response) => void;
  const fetch = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; }));
  vi.stubGlobal('fetch', fetch);
  render(<MemoryRouter><MembershipList userId='singer' currentChoirId='a' /></MemoryRouter>);
  await screen.findByRole('link', { name: /^爱情/ });
  await waitFor(() => expect(finish).toBeDefined());
  return { finish, fetch };
}

it('cached ownership label is visible before cloud response', async () => {
  await setup();
  expect(screen.getByRole('link', { name: /PPOE.*拥有者/ })).toBeInTheDocument();
});

it('pending cloud response does not change the row at the first click position', async () => {
  const { finish } = await setup();
  const initial = screen.getAllByRole('link').map(row => row.getAttribute('href'));
  await act(async () => finish(Response.json({ memberships: [
    { id: 'member-b', displayName: '歌者', isOwner: false, choir: { id: 'b', name: 'PPOE', guestAdmissionMode: 'invite' } },
    { id: 'member-a', displayName: '歌者', isOwner: false, choir: { id: 'a', name: '爱情', guestAdmissionMode: 'invite' } },
  ] })));
  expect(await screen.findByRole('link', { name: /PPOE.*成员/ })).toBeInTheDocument();
  expect(screen.getAllByRole('link').map(row => row.getAttribute('href'))).toEqual(initial);
});

it('reopening picker reuses recently confirmed roles without another cloud read', async () => {
  const { finish, fetch } = await setup();
  await act(async () => finish(Response.json({ memberships: [
    { id: 'member-b', displayName: '歌者', isOwner: false, choir: { id: 'b', name: 'PPOE', guestAdmissionMode: 'invite' } },
  ] })));
  expect(await screen.findByRole('link', { name: /PPOE.*成员/ })).toBeInTheDocument();
  // Unmount/reopen is the switcher's actual lifetime on dialog close/open.
  cleanup();
  render(<MemoryRouter><MembershipList userId='singer' currentChoirId='a' /></MemoryRouter>);
  await screen.findByRole('link', { name: /PPOE.*成员/ });
  expect(screen.getByRole('link', { name: /PPOE.*成员/ })).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('keeps a revoked cached drive disabled when reopening while the next read is delayed', async () => {
  const { finish, fetch } = await setup();
  await act(async () => finish(Response.json({ memberships: [
    { id: 'member-a', displayName: '歌者', isOwner: false, choir: { id: 'a', name: '爱情', guestAdmissionMode: 'invite' } },
    { id: 'member-b', displayName: '歌者', isOwner: true, choir: { id: 'b', name: 'PPOE', guestAdmissionMode: 'invite' } },
  ] })));
  cleanup();
  act(() => observeNavigationResponse('/api/choirs/a/bootstrap', undefined, new Response(null, { status: 403 })));
  render(<MemoryRouter><MembershipList userId='singer' currentChoirId='a' /></MemoryRouter>);
  expect(await screen.findByRole('link', { name: /爱情.*已不可用/ })).toHaveAttribute('aria-disabled', 'true');
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  expect(screen.getByRole('link', { name: /爱情.*已不可用/ })).not.toHaveAttribute('href');
});

it('preserves modified current-drive clicks for a new browser tab', async () => {
  await setup();
  const current = screen.getByRole('link', { name: /^爱情/ });
  const modified = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true, button: 0 });
  expect(current.dispatchEvent(modified)).toBe(true);
  expect(modified.defaultPrevented).toBe(false);
  expect(fireEvent.click(current)).toBe(false);
});
