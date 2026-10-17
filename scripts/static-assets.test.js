import { describe, expect, it, vi } from 'vitest';
import { serveStaticAsset } from '../worker/static-assets';

describe('static asset boundary', () => {
 it('turns an HTML SPA fallback for a stale chunk into an uncacheable 404', async () => {
  const request = new Request('https://same-page.test/assets/musicxml-player-old.js');
  const assets = { fetch: vi.fn(async () => new Response('<!doctype html><html></html>', {headers:{'Content-Type':'text/html','Cache-Control':'public, max-age=31536000, immutable'}})) };
  const response = await serveStaticAsset(request, assets);
  expect(response.status).toBe(404); expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.text()).not.toContain('<html>');
 });
 it('does not cache ordinary missing responses and leaves genuine asset bytes and cache headers intact', async () => {
  const missing = await serveStaticAsset(new Request('https://same-page.test/assets/missing.js'), {fetch:vi.fn(async () => new Response(null,{status:404,headers:{'Cache-Control':'public,max-age=31536000,immutable'}}))});
  expect(missing.status).toBe(404); expect(missing.headers.get('cache-control')).toBe('no-store');
  const valid = new Response('export const ok=true;', {headers:{'Content-Type':'application/javascript','Cache-Control':'public,max-age=31536000,immutable'}});
  const response = await serveStaticAsset(new Request('https://same-page.test/assets/current.js'), {fetch:vi.fn(async () => valid)});
  expect(response).toBe(valid); expect(await response.text()).toBe('export const ok=true;');
 });
});
