import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Releases } from './releases';

const A = 'a'.repeat(40), B = 'b'.repeat(40), C = 'c'.repeat(40);
const versions = { [A]: 'v26.10.22.1400', [B]: 'v26.10.22.1500', [C]: 'v26.10.22.1600' };
const snapshot = (stable = A, beta = B, revision = 1) => ({ stable, beta, revision, releases: [
  { buildId: stable, version: versions[stable], publishedAt: Date.parse('2026-10-22T06:00:00Z') },
  { buildId: beta, version: versions[beta], publishedAt: Date.parse('2026-10-22T07:00:00Z') },
], events: [] });
afterEach(() => vi.unstubAllGlobals());

it('shows each channel with its version and reports an exact promotion', async () => {
  let current = snapshot();
  const calls: unknown[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    if (init?.method === 'POST') {
      calls.push(JSON.parse(init.body)); current = snapshot(B, B, 2);
      return new Response(null, { status: 204 });
    }
    return Response.json(current);
  }));
  render(<Releases onError={vi.fn()} />);
  const button = await screen.findByRole('button', { name: '将 v26.10.22.1500 设为稳定版' });
  const stableRow = screen.getByRole('row', { name: /稳定版.*默认用户/ });
  expect(within(stableRow).getByText('v26.10.22.1400')).toBeVisible();
  expect(screen.getByText('还没有提升记录。')).toBeVisible();
  fireEvent.click(button);
  expect(screen.getByRole('dialog', { name: '将测试版设为稳定版？' })).toBeVisible();
  expect(calls).toEqual([]);
  expect(screen.getByRole('dialog')).toHaveTextContent('v26.10.22.1400 更新到 v26.10.22.1500');
  expect(screen.getByRole('dialog')).not.toHaveTextContent(B.slice(0, 7));
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(calls).toEqual([]);
  fireEvent.click(button);
  fireEvent.click(screen.getByRole('button', { name: '确认设为稳定版' }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('已将 v26.10.22.1500 设为稳定版。'));
  expect(calls).toEqual([expect.objectContaining({ expectedBeta: B, expectedRevision: 1 })]);
  expect(button).toBeDisabled();
});

it('requires a successful reread after a stale promotion before confirming the new target', async () => {
  let current = snapshot();
  const calls: unknown[] = [];
  const onError = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    if (init?.method === 'POST') {
      calls.push(JSON.parse(init.body)); current = snapshot(A, C, 2);
      return Response.json({ error: 'release_conflict' }, { status: 409 });
    }
    return Response.json(current);
  }));
  render(<Releases onError={onError} />);
  const button = await screen.findByRole('button', { name: '将 v26.10.22.1500 设为稳定版' });
  fireEvent.click(button);
  fireEvent.click(screen.getByRole('button', { name: '确认设为稳定版' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('请重新读取版本后确认');
  expect(button).toBeDisabled();
  expect(screen.queryByRole('button', { name: '将 v26.10.22.1600 设为稳定版' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重新读取版本' }));
  expect(await screen.findByRole('button', { name: '将 v26.10.22.1600 设为稳定版' })).toBeEnabled();
  expect(calls).toEqual([expect.objectContaining({ expectedBeta: B, expectedRevision: 1 })]);
  expect(onError).toHaveBeenCalledOnce();
});

it('shows original versions in promotion history and keeps hashes inside technical details', async () => {
  const data = { ...snapshot(), events: [{ id: 'promotion', previousStable: A, target: B, createdAt: Date.parse('2026-10-22T08:00:00Z') }] };
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(data)));
  render(<Releases onError={vi.fn()} />);
  const history = await screen.findByRole('region', { name: '提升记录' });
  expect(history).toHaveTextContent('v26.10.22.1400 → v26.10.22.1500');
  expect(history).not.toHaveTextContent(A.slice(0, 7));
  fireEvent.click(screen.getByText('技术详情 · 构建标识'));
  expect(screen.getByText(A)).toBeVisible();
});

it('does not invent a version number for an older response without version metadata', async () => {
  const data = snapshot();
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ...data, releases: data.releases.map(({ buildId, publishedAt }) => ({ buildId, publishedAt })) })));
  render(<Releases onError={vi.fn()} />);
  expect(await screen.findByRole('button', { name: '将当前测试版设为稳定版' })).toBeVisible();
  const table = screen.getByRole('table');
  expect(within(table).getAllByText('版本号未记录')).toHaveLength(2);
  expect(table).not.toHaveTextContent('v26.10.22');
  expect(table).not.toHaveTextContent(A.slice(0, 7));
});

it('shows only the current beta verification and warns in the promotion dialog', async () => {
  let current = { ...snapshot(), verification: { buildId: B, status: 'failure', runId: 123, updatedAt: Date.parse('2026-10-22T08:00:00Z') } };
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(current)));
  render(<Releases onError={vi.fn()} />);
  const status = await screen.findByRole('region', { name: '当前测试版的验证' });
  expect(status).toHaveTextContent('发布前所选 CI 检查：通过');
  expect(status).toHaveTextContent('扩展浏览器检查（最近记录）：失败');
  expect(within(status).getByRole('link', { name: '查看运行详情' })).toHaveAttribute('href', 'https://github.com/clydian/same-page/actions/runs/123');
  fireEvent.click(screen.getByRole('button', { name: '将 v26.10.22.1500 设为稳定版' }));
  expect(screen.getByRole('dialog')).toHaveTextContent('扩展浏览器检查：失败');
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  current = { ...snapshot(A, C, 2), verification: current.verification };
  fireEvent.click(screen.getByRole('button', { name: '重新读取版本' }));
  await screen.findByRole('button', { name: '将 v26.10.22.1600 设为稳定版' });
  expect(status).toHaveTextContent('扩展浏览器检查（最近记录）：暂无结果或暂不可用');
  expect(status).toHaveTextContent('发布前所选 CI 检查：暂无记录');
  expect(within(status).queryByRole('link')).toBeNull();
});
