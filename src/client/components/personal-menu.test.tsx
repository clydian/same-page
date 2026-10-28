import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { PersonalMenu } from './personal-menu';

const { identity } = vi.hoisted(() => ({ identity: {
  authenticatedUserId: 'operator', authenticatedSessionId: 'session-a',
} }));
vi.mock('../auth/application-identity', () => ({ useApplicationIdentity: () => identity }));
vi.mock('../navigation/navigation-context', () => ({ useExitLayer: () => undefined }));
const capabilities = { viewScores: 0, reviewXml: 0, publishXml: 0, manageReports: 0, deleteReports: 0 };
afterEach(() => {
  vi.unstubAllGlobals();
  identity.authenticatedUserId = 'operator'; identity.authenticatedSessionId = 'session-a';
});

it.each([
  { label: 'outside a drive', drive: undefined, driveLinks: [] },
  { label: 'inside a drive', drive: { choirId: 'drive-a', choirName: '排练云盘', localOnly: false }, driveLinks: [
    ['阅读偏好', '/choirs/drive-a/preferences'], ['本机存储', '/choirs/drive-a/storage'],
  ] },
  { label: 'with membership identity management', drive: { choirId: 'drive-a', choirName: '排练云盘', localOnly: false, canManageIdentity: true }, driveLinks: [
    ['云盘内身份', '/choirs/drive-a/me'], ['阅读偏好', '/choirs/drive-a/preferences'], ['本机存储', '/choirs/drive-a/storage'],
  ] },
])('routes personal actions in their correct scope $label', async ({ drive, driveLinks }) => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(capabilities)));
  render(<MemoryRouter><PersonalMenu drive={drive} /></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: '我的' }));
  const links = [...driveLinks, ['账户', '/user'], ['外观', '/appearance'], ['关于与更新', '/about']];
  for (const [name, href] of links) {
    expect(screen.getByRole('menuitem', { name: name === '关于与更新' ? /^关于与更新/ : name })).toHaveAttribute('href', href);
  }
  const expected = [...links.map(([name]) => name), '退出登录'];
  const actions = screen.getAllByRole('menuitem')
    .filter(item => item.getAttribute('aria-disabled') !== 'true')
    .map(item => item.textContent?.startsWith('关于与更新') ? '关于与更新' : item.textContent);
  expect(actions.sort()).toEqual(expected.sort());
});

it.each(['manageReleases', 'viewScores', 'manageReports'])('shows the app entry after confirming %s authority', async capability => {
  const fetch = vi.fn(async () => Response.json({ ...capabilities, [capability]: 1 }));
  vi.stubGlobal('fetch', fetch);
  render(<MemoryRouter><PersonalMenu email="operator@example.invalid" /></MemoryRouter>);
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '我的' }));
  expect(await screen.findByRole('menuitem', { name: '产品后台' })).toHaveAttribute('href', '/admin');
  expect(fetch).toHaveBeenCalledOnce();
});

it.each(['denied', 'unavailable', 'no-capabilities'])('keeps ordinary menu actions without an admin entry when %s', async outcome => {
  const fetch = vi.fn(async () => {
    if (outcome === 'unavailable') throw new TypeError('Network unavailable');
    return outcome === 'denied' ? Response.json({ error: 'forbidden' }, { status: 403 }) : Response.json(capabilities);
  });
  vi.stubGlobal('fetch', fetch);
  render(<MemoryRouter><PersonalMenu /></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: '我的' }));
  await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  await act(async () => undefined);
  expect(screen.queryByRole('menuitem', { name: '产品后台' })).toBeNull();
  expect(screen.getByRole('menuitem', { name: /^关于与更新/ })).toBeVisible();
  expect(screen.getByRole('menuitem', { name: '退出登录' })).toBeVisible();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('ignores a late authorization result from the previous session', async () => {
  let finish!: (response: Response) => void;
  const fetch = vi.fn()
    .mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }))
    .mockResolvedValue(Response.json({ error: 'forbidden' }, { status: 403 }));
  vi.stubGlobal('fetch', fetch);
  const { rerender } = render(<MemoryRouter><PersonalMenu /></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: '我的' }));
  await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  identity.authenticatedUserId = 'ordinary-user'; identity.authenticatedSessionId = 'session-b';
  rerender(<MemoryRouter><PersonalMenu /></MemoryRouter>);
  await act(async () => finish(Response.json({ ...capabilities, manageReleases: 1 })));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole('menuitem', { name: '产品后台' })).toBeNull();
});

it('rereads permissions when reopening the menu after authority is revoked', async () => {
  vi.stubGlobal('fetch', vi.fn()
    .mockResolvedValueOnce(Response.json({ ...capabilities, manageReleases: 1 }))
    .mockResolvedValue(Response.json({ error: 'forbidden' }, { status: 403 })));
  render(<MemoryRouter><PersonalMenu /></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: '我的' }));
  expect(await screen.findByRole('menuitem', { name: '产品后台' })).toBeVisible();
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
  fireEvent.click(screen.getByRole('button', { name: '我的' }));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  await act(async () => undefined);
  expect(screen.queryByRole('menuitem', { name: '产品后台' })).toBeNull();
});

it('keeps experience appearance separate when opening its independent entry', () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(capabilities)));
  render(<MemoryRouter initialEntries={['/choirs/preview/scores/score?experience=1']}><PersonalMenu /></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: '我的' }));
  expect(screen.getByRole('menuitem', { name: '外观' })).toHaveAttribute('href', '/appearance?experience=1');
  expect(screen.getByRole('menuitem', { name: '账户' })).toHaveAttribute('href', '/user');
});
