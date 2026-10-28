import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { digest, inventory, previewCleanup, applyCleanup, cleanupReport, BUCKET } from './frontend-cleanup.mjs';
import { assertApplyEnvironment, validatePreviewRun } from './frontend-cleanup-cli.mjs';

const stable = 'a'.repeat(40), beta = 'b'.repeat(40), old = 'c'.repeat(40), source = 'd'.repeat(40);
function fixture({ same = false, oldCount = 2 } = {}) {
  const data = new Map(), metadata = new Map();
  const put = (key, body) => data.set(key, Buffer.from(body));
  const manifests = new Map();
  const releases = [];
  for (const id of same ? [stable] : [stable, beta]) {
    const files = Object.fromEntries(['index.html', 'sw.js', 'build.json', 'shell-manifest.json', 'manifest.webmanifest', 'assets/player.js'].map(file => {
      const body = Buffer.from(`${id}/${file}`);
      put(`releases/${id}/${file}`, body);
      return [file, { sha256: digest(body), bytes: body.length, contentType: 'text/plain' }];
    }));
    const manifest = { buildId: id, contract: 'same-page-storage-v15-sync-v1', files, storageDigest: digest('storage'), probeDigest: digest('probe') };
    manifests.set(id, manifest);
    for (const file of ['sealed.json', 'claim.json']) put(`releases/${id}/${file}`, JSON.stringify(manifest));
    put(`releases/${id}/storage.json`, 'storage');
    put(`releases/${id}/storage-probe.js`, 'probe');
    releases.push({ build_id: id, ready: 1, contract: manifest.contract, manifest_digest: digest(JSON.stringify(manifest)) });
  }
  const proof = JSON.stringify({ version: 1, passed: true, stable, candidate: beta, stableProbe: digest('probe'), candidateProbe: digest('probe'), engines: ['chromium', 'webkit'] });
  if (!same) put(`compatibility/${beta}/${stable}.json`, proof);
  put('legacy/assets/old.js', 'shared');
  put(`legacy-claims/${old}.json`, 'audit');
  put(`compatibility/${old}/${stable}.json`, 'audit');
  put('unrecognized/file', 'unknown');
  put('releases/malformed/file', 'unknown');
  for (let i = 0; i < oldCount; i++) put(`releases/${old}/${i}.js`, 'old');
  const catalog = { channels: { stable, beta: same ? stable : beta, revision: 8 }, releases, proof: same ? null : { report_digest: digest(proof) } };
  const batches = [];
  const store = {
    async catalog() { return structuredClone(catalog); },
    async get(key) { const body = data.get(key); return body ? { body, sha256: metadata.has(key) ? metadata.get(key) : digest(body) } : null; },
    async list(cursor) {
      const objects = [...data].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([key, bytes]) => ({ key, bytes: bytes.length, etag: digest(bytes) }));
      const offset = Number(cursor ?? 0), limit = 7;
      return { objects: objects.slice(offset, offset + limit), cursor: offset + limit < objects.length ? String(offset + limit) : undefined };
    },
    async deleteBatch(keys) { batches.push(keys); keys.forEach(key => data.delete(key)); return { deleted: keys, errors: [] }; },
  };
  return { store, data, put, catalog, batches, manifests, metadata };
}

describe('one-off frontend release cleanup', () => {
  it('paginates the entire inventory, previews exact historical objects and preserves current/shared/audit resources', async () => {
    const f = fixture(), plan = await previewCleanup(f.store, source);
    expect(plan.bucket).toBe(BUCKET);
    expect(plan.objects).toHaveLength(f.data.size);
    expect(plan.objects.filter(item => item.disposition === 'delete').map(item => item.key)).toEqual([`releases/${old}/0.js`, `releases/${old}/1.js`]);
    expect(plan.objects.find(item => item.key === 'legacy/assets/old.js').disposition).toBe('review');
    expect(f.batches).toEqual([]);
    expect(cleanupReport(plan)).toContain('2 objects / 6 bytes');
  });
  it('supports identical stable/beta without requiring a self-proof', async () => {
    const f = fixture({ same: true });
    const plan = await previewCleanup(f.store, source);
    expect(plan.keep).toEqual([stable]);
    await applyCleanup(f.store, plan, { source });
    expect(f.data.has(`releases/${stable}/sw.js`)).toBe(true);
  });
  it('deletes batches and verifies both current releases after cleanup', async () => {
    const f = fixture({ oldCount: 1001 }), plan = await previewCleanup(f.store, source), journal = [];
    const result = await applyCleanup(f.store, plan, { source, journal: async value => journal.push(structuredClone(value)) });
    expect(f.batches.map(batch => batch.length)).toEqual([500, 500, 1]);
    expect(result.deleted).toHaveLength(1001);
    expect(journal.at(-1).complete).toBe(true);
    expect([...f.data.keys()].some(key => key.startsWith(`releases/${old}/`))).toBe(false);
    expect(f.data.has('legacy/assets/old.js')).toBe(true);
  });
  it.each(['sw.js', 'storage.json', 'storage-probe.js', 'claim.json', 'sealed.json'])('refuses corrupted protected %s before deleting', async file => {
    const f = fixture(), plan = await previewCleanup(f.store, source);
    f.put(`releases/${stable}/${file}`, 'corrupt');
    await expect(applyCleanup(f.store, plan, { source })).rejects.toThrow();
    expect(f.batches).toHaveLength(0);
    await expect(previewCleanup(f.store, source)).rejects.toThrow();
  });
  it.each([undefined, 'incorrect'])('rejects intact bytes with missing or wrong serving metadata: %s', async value => {
    const f = fixture(), plan = await previewCleanup(f.store, source);
    f.metadata.set(`releases/${stable}/sw.js`, value);
    await expect(previewCleanup(f.store, source)).rejects.toThrow('serving metadata mismatch');
    await expect(applyCleanup(f.store, plan, { source })).rejects.toThrow('serving metadata mismatch');
    expect(f.batches).toHaveLength(0);
  });
  it('refuses missing/current incompatible proof and unready catalog entries', async () => {
    const f = fixture();
    f.catalog.proof = null;
    await expect(previewCleanup(f.store, source)).rejects.toThrow('proof missing');
    f.catalog.releases[0].ready = 0;
    await expect(previewCleanup(f.store, source)).rejects.toThrow('not ready');
  });
  it.each(['added', 'replaced', 'retained missing', 'channels'])('stops on changed production state: %s', async change => {
    const f = fixture(), plan = await previewCleanup(f.store, source);
    if (change === 'added') f.put(`releases/${old}/new.js`, 'new');
    if (change === 'replaced') f.put(`releases/${old}/0.js`, 'replacement');
    if (change === 'retained missing') f.data.delete('legacy/assets/old.js');
    if (change === 'channels') f.catalog.channels.revision++;
    await expect(applyCleanup(f.store, plan, { source })).rejects.toThrow();
    expect(f.batches).toHaveLength(0);
  });
  it('rechecks channel revision before each delete batch', async () => {
    const f = fixture({ oldCount: 501 }), plan = await previewCleanup(f.store, source);
    const deleteBatch = f.store.deleteBatch;
    f.store.deleteBatch = async keys => { const result = await deleteBatch(keys); f.catalog.channels.revision++; return result; };
    await expect(applyCleanup(f.store, plan, { source })).rejects.toThrow('Channels/catalog changed');
    expect(f.batches).toHaveLength(1);
    expect(f.data.has(`releases/${old}/99.js`)).toBe(true);
  });
  it('records partial deletion errors, stops, and safely resumes the same reviewed plan', async () => {
    const f = fixture(), plan = await previewCleanup(f.store, source), journal = [];
    const deleteBatch = f.store.deleteBatch;
    f.store.deleteBatch = async keys => {
      await deleteBatch(keys.slice(0, 1));
      return { deleted: keys.slice(0, 1), errors: [{ key: keys[1], code: 'AccessDenied' }] };
    };
    await expect(applyCleanup(f.store, plan, { source, journal: async state => journal.push(structuredClone(state)) })).rejects.toThrow('Partial R2 deletion');
    expect(journal.at(-1).lastBatch.errors[0].code).toBe('AccessDenied');
    f.store.deleteBatch = deleteBatch;
    expect((await applyCleanup(f.store, plan, { source })).complete).toBe(true);
  });
  it('can resume after a lost successful deletion response', async () => {
    const f = fixture(), plan = await previewCleanup(f.store, source), original = f.store.deleteBatch;
    f.store.deleteBatch = async keys => { await original(keys); throw new Error('connection lost'); };
    await expect(applyCleanup(f.store, plan, { source })).rejects.toThrow('connection lost');
    f.store.deleteBatch = original;
    expect((await applyCleanup(f.store, plan, { source })).complete).toBe(true);
  });
  it.each(['bucket', 'source', 'classification', 'keep'])('rejects tampered plan %s', async change => {
    const f = fixture(), plan = await previewCleanup(f.store, source);
    if (change === 'bucket') plan.bucket = 'same-page-production-scores';
    if (change === 'source') plan.source = old;
    if (change === 'classification') plan.objects.find(item => item.disposition === 'keep').disposition = 'delete';
    if (change === 'keep') plan.keep = [old];
    await expect(applyCleanup(f.store, plan, { source })).rejects.toThrow();
    expect(f.batches).toHaveLength(0);
  });
  it('fails closed on listing failures, duplicate keys and repeated cursors', async () => {
    const f = fixture();
    f.store.list = async () => { throw new Error('page unavailable'); };
    await expect(inventory(f.store)).rejects.toThrow('page unavailable');
    f.store.list = async () => ({ objects: [{ key: 'x', bytes: 1, etag: 'x' }], cursor: 'same' });
    await expect(inventory(f.store)).rejects.toThrow('Duplicate');
    f.store.list = async () => ({ objects: [], cursor: 'same' });
    await expect(inventory(f.store)).rejects.toThrow('did not advance');
  });
  it('rejects unsafe sealed file paths even when the catalog digest matches', async () => {
    const f = fixture(), manifest = f.manifests.get(stable);
    manifest.files['../escape'] = { bytes: 1, sha256: digest('x') };
    const bytes = JSON.stringify(manifest);
    f.put(`releases/${stable}/sealed.json`, bytes);
    f.catalog.releases[0].manifest_digest = digest(bytes);
    await expect(previewCleanup(f.store, source)).rejects.toThrow();
  });
});

const run = { id: 12, run_attempt: 2, repository: { full_name: 'clydian/same-page' }, head_repository: { full_name: 'clydian/same-page' }, path: '.github/workflows/frontend-cleanup.yml', event: 'workflow_dispatch', head_branch: 'main', head_sha: source, status: 'completed', conclusion: 'success' };
const artifact = { id: 45, name: 'frontend-cleanup-plan-12-2', expired: false, workflow_run: { head_sha: source }, digest: `sha256:${'f'.repeat(64)}` };
describe('manual cleanup workflow provenance', () => {
  it('accepts only the exact successful main preview attempt', () => {
    expect(validatePreviewRun(run, [artifact], source)).toBe(45);
    for (const change of [{ event: 'pull_request' }, { head_branch: 'other' }, { head_sha: old }, { conclusion: 'failure' }, { path: '.github/workflows/ci.yml' }, { run_attempt: 3 }, { head_repository: { full_name: 'fork/same-page' } }]) {
      expect(() => validatePreviewRun({ ...run, ...change }, [artifact], source)).toThrow();
    }
    expect(() => validatePreviewRun(run, [{ ...artifact, expired: true }], source)).toThrow();
  });
  it('rejects local apply and untrusted refs/workflows', () => {
    const env = { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'clydian/same-page', GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main', GITHUB_WORKFLOW_REF: 'clydian/same-page/.github/workflows/frontend-cleanup.yml@refs/heads/main' };
    expect(() => assertApplyEnvironment(env)).not.toThrow();
    for (const key of Object.keys(env)) expect(() => assertApplyEnvironment({ ...env, [key]: 'wrong' })).toThrow();
  });
  it('has no automatic trigger and shares the production deployment lock', async () => {
    const workflow = await readFile(new URL('../.github/workflows/frontend-cleanup.yml', import.meta.url), 'utf8');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).not.toMatch(/^  (?:push|schedule|pull_request):/m);
    expect(workflow).toContain('group: same-page-production');
    expect(workflow).toContain('default: preview');
    expect(workflow).toContain('environment: production');
    expect(workflow).toContain('digest-mismatch: error');
  });
});
