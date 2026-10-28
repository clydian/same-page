import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { verifyCompatibilityReport } from './frontend-release.mjs';
import { releaseManifestSchema, releaseContract as contract } from '../src/shared/release-channels.ts';

export const BUCKET = 'same-page-frontend-releases';
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const sha = /^[a-f0-9]{40}$/;
const hash = /^[a-f0-9]{64}$/;
const releaseKey = /^releases\/([a-f0-9]{40})\/.+$/;
const requiredFiles = ['index.html', 'sw.js', 'build.json', 'shell-manifest.json', 'manifest.webmanifest'];

function targets(catalog) {
  const { stable, beta, revision } = catalog.channels ?? {};
  assert.match(stable ?? '', sha, 'Missing stable target');
  assert.match(beta ?? '', sha, 'Missing beta target');
  assert.ok(Number.isSafeInteger(revision) && revision > 0, 'Invalid channel revision');
  return [...new Set([stable, beta])].sort();
}

export async function inventory(store) {
  const objects = [], cursors = new Set(), keys = new Set();
  let cursor;
  do {
    const page = await store.list(cursor);
    assert.ok(Array.isArray(page.objects), 'Invalid R2 listing');
    for (const object of page.objects) {
      assert.ok(typeof object.key === 'string' && object.key.length > 0 && !keys.has(object.key), 'Duplicate/invalid R2 key');
      assert.ok(Number.isSafeInteger(object.bytes) && object.bytes >= 0 && typeof object.etag === 'string' && object.etag, 'Missing R2 object identity');
      keys.add(object.key);
      objects.push({ key: object.key, bytes: object.bytes, etag: object.etag });
    }
    cursor = page.cursor;
    if (cursor !== undefined) {
      assert.ok(typeof cursor === 'string' && cursor.length > 0 && !cursors.has(cursor), 'R2 pagination did not advance');
      cursors.add(cursor);
    }
  } while (cursor !== undefined);
  return objects.sort((a, b) => a.key.localeCompare(b.key, 'en'));
}

async function checkedBytes(store, key, expected, bytes) {
  const object = await store.get(key);
  assert.ok(object, `Missing protected object: ${key}`);
  const body = object.body;
  assert.equal(digest(body), expected, `Protected object hash mismatch: ${key}`);
  if (bytes !== undefined) {
    assert.equal(body.length, bytes, `Protected object size mismatch: ${key}`);
    assert.equal(object.sha256, expected, `Protected serving metadata mismatch: ${key}`);
  }
  return body;
}

// Four readers bound memory and avoid serially downloading two complete releases.
async function verifyFiles(files, check) {
  let next = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < files.length) await check(files[next++]);
  }));
}

export async function verifyProtected(store, catalog) {
  const manifests = new Map();
  for (const id of targets(catalog)) {
    const row = catalog.releases.find(row => row.build_id === id);
    assert.ok(row?.ready === 1 && row.contract === contract, 'Protected release is not ready');
    assert.match(row.manifest_digest ?? '', hash);
    const prefix = `releases/${id}/`;
    const sealed = await checkedBytes(store, prefix + 'sealed.json', row.manifest_digest);
    assert.ok(sealed.length <= 512 * 1024, 'Oversized manifest');
    const manifest = releaseManifestSchema.parse(JSON.parse(sealed));
    assert.equal(manifest.buildId, id);
    for (const file of requiredFiles) assert.ok(Object.hasOwn(manifest.files, file), `Missing sealed ${file}`);
    const files = Object.entries(manifest.files);
    for (const [file] of files) {
      assert.match(file, /^(?!.*(?:^|\/)\.\.?($|\/))[a-zA-Z0-9_./@-]+$/);
      assert.ok(!file.startsWith('/') && !['sealed.json', 'claim.json', 'storage.json', 'storage-probe.js'].includes(file), 'Unsafe manifest path');
    }
    await checkedBytes(store, prefix + 'claim.json', row.manifest_digest);
    await checkedBytes(store, prefix + 'storage.json', manifest.storageDigest);
    await checkedBytes(store, prefix + 'storage-probe.js', manifest.probeDigest);
    await verifyFiles(files, ([file, entry]) => checkedBytes(store, prefix + file, entry.sha256, entry.bytes));
    manifests.set(id, manifest);
  }
  const { stable, beta } = catalog.channels;
  if (stable !== beta) {
    assert.ok(catalog.proof, 'Current channel compatibility proof missing');
    const bytes = await checkedBytes(store, `compatibility/${beta}/${stable}.json`, catalog.proof.report_digest);
    assert.ok(bytes.length <= 4096, 'Oversized compatibility report');
    verifyCompatibilityReport(JSON.parse(bytes), {
      stable, candidate: beta, stableProbe: manifests.get(stable).probeDigest, candidateProbe: manifests.get(beta).probeDigest,
    });
  }
}

function classify(objects, keep) {
  return objects.map(object => {
    const match = releaseKey.exec(object.key);
    const disposition = match ? (keep.includes(match[1]) ? 'keep' : 'delete') : 'review';
    return { ...object, disposition };
  });
}

export async function previewCleanup(store, source) {
  assert.match(source ?? '', sha, 'Trusted control SHA required');
  const catalog = await store.catalog();
  const keep = targets(catalog);
  const objects = await inventory(store);
  await verifyProtected(store, catalog);
  assert.deepEqual(await store.catalog(), catalog, 'Channels changed during preview');
  return { version: 1, bucket: BUCKET, source, createdAt: new Date().toISOString(), catalog, keep, objects: classify(objects, keep) };
}

function validatePlan(plan, source) {
  assert.equal(plan.version, 1);
  assert.equal(plan.bucket, BUCKET);
  assert.equal(plan.source, source, 'Controls changed; generate a new preview');
  assert.deepEqual(plan.keep, targets(plan.catalog));
  const keys = new Set();
  for (const object of plan.objects) {
    assert.ok(!keys.has(object.key), 'Duplicate plan object');
    keys.add(object.key);
  }
  assert.deepEqual(plan.objects, classify(plan.objects.map(({ key, bytes, etag }) => ({ key, bytes, etag })), plan.keep), 'Plan classification changed');
}

function assertUnchangedInventory(current, plan) {
  const expected = new Map(plan.objects.map(object => [object.key, object]));
  for (const object of current) {
    const previous = expected.get(object.key);
    assert.ok(previous && previous.bytes === object.bytes && previous.etag === object.etag, `Inventory changed: ${object.key}; generate a new preview`);
    expected.delete(object.key);
  }
  for (const object of expected.values()) assert.equal(object.disposition, 'delete', `Retained object missing: ${object.key}`);
}

export async function applyCleanup(store, plan, { source, journal = async () => {} }) {
  validatePlan(plan, source);
  const check = async () => {
    assert.deepEqual(await store.catalog(), plan.catalog, 'Channels/catalog changed; generate a new preview');
    const current = await inventory(store);
    assertUnchangedInventory(current, plan);
    return current;
  };
  await check();
  await verifyProtected(store, plan.catalog);
  const deleted = [], results = { deleted, complete: false };
  await journal(results);
  const pending = plan.objects.filter(object => object.disposition === 'delete');
  for (let offset = 0; offset < pending.length; offset += 500) {
    const current = new Set((await check()).map(object => object.key));
    const keys = pending.slice(offset, offset + 500).map(object => object.key).filter(key => current.has(key));
    if (!keys.length) continue;
    // Partial failures are recorded before stopping. A retry accepts only missing planned deletions.
    const result = await store.deleteBatch(keys);
    results.lastBatch = result;
    const acknowledged = new Set(result.deleted ?? []);
    assert.ok([...acknowledged].every(key => keys.includes(key)), 'Unexpected deletion acknowledgement');
    deleted.push(...acknowledged);
    await journal(results);
    assert.ok(!result.errors?.length && keys.every(key => acknowledged.has(key)), 'Partial R2 deletion; inspect journal, retry the same reviewed plan');
  }
  const remaining = await check();
  const plannedKeys = new Set(pending.map(object => object.key));
  assert.ok(!remaining.some(object => plannedKeys.has(object.key)), 'Planned objects remain');
  await verifyProtected(store, plan.catalog);
  results.complete = true;
  await journal(results);
  return results;
}

export function cleanupReport(plan) {
  const summarize = disposition => {
    const objects = plan.objects.filter(object => object.disposition === disposition);
    return `${objects.length} objects / ${objects.reduce((sum, object) => sum + object.bytes, 0)} bytes`;
  };
  const deletedVersions = [...new Set(plan.objects.filter(object => object.disposition === 'delete').map(object => releaseKey.exec(object.key)[1]))];
  return `# 一次性前端清理预览\n\n- 桶：${plan.bucket}\n- stable：${plan.catalog.channels.stable}\n- beta：${plan.catalog.channels.beta}\n- revision：${plan.catalog.channels.revision}\n- 保留当前版本：${summarize('keep')}\n- 删除历史版本：${summarize('delete')}（${deletedVersions.length} 个版本目录）\n- 保留待核对／审计记录：${summarize('review')}\n\n仅删除 plan.json 中 disposition=delete 的精确对象。legacy/、compatibility/、legacy-claims/ 及未知前缀均保留；本次不修改 D1。\n\n## 待删除版本\n\n${deletedVersions.map(id => `- ${id}`).join('\n') || '无'}\n\n## 保留的非版本对象\n\n${plan.objects.filter(object => object.disposition === 'review').map(object => `- ${JSON.stringify(object.key)} (${object.bytes} bytes)`).join('\n') || '无'}\n`;
}
