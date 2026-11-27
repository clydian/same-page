import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { verifyCompatibilityReport } from './frontend-release.mjs';
import { approvedBuilds, cutoff, snapshotProtected } from './frontend-cleanup-609.mjs';
import { releaseManifestSchema, releaseContract as contract } from '../src/shared/release-channels.ts';

export const BUCKET = 'same-page-frontend-releases';
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const sha = /^[a-f0-9]{40}$/;
const hash = /^[a-f0-9]{64}$/;
const releaseKey = /^releases\/([a-f0-9]{40})\/([a-zA-Z0-9_.@-]+(?:\/[a-zA-Z0-9_.@-]+)*)$/;
const approved = new Set(approvedBuilds);
const snapshotKeep = new Set(snapshotProtected);
const snapshotObjectCount = 15_423;
const snapshotBytes = 2_428_556_713;
const requiredFiles = ['index.html', 'sw.js', 'build.json', 'shell-manifest.json', 'manifest.webmanifest'];

function targets(catalog) {
  const { stable, beta, revision } = catalog.channels ?? {};
  assert.match(stable ?? '', sha, 'Missing stable target');
  assert.match(beta ?? '', sha, 'Missing beta target');
  assert.ok(Number.isSafeInteger(revision) && revision >= 96, 'Invalid channel revision');
  const [latest, previous] = catalog.audit.recent;
  assert.match(latest?.build ?? '', sha, 'Missing verified recent Beta');
  assert.match(previous?.build ?? '', sha, 'Missing verified previous Beta');
  assert.notEqual(latest.build, previous.build);
  assert.ok(beta === stable || beta === latest.build, 'Current Beta does not match the trusted admission audit');
  return [...new Set([stable, beta, latest.build, previous.build])].sort();
}

function stableHistory(catalog) {
  const keep = new Set();
  let lastRevision = 0, lastStable;
  for (const { previous_stable, expected_beta, expected_revision } of catalog.promotions) {
    assert.match(previous_stable ?? '', sha);
    assert.match(expected_beta ?? '', sha);
    assert.ok(Number.isSafeInteger(expected_revision) && expected_revision > lastRevision
      && expected_revision < catalog.channels.revision, 'Invalid Stable promotion revision');
    if (lastStable) assert.equal(previous_stable, lastStable, 'Stable promotion chain is incomplete');
    keep.add(previous_stable).add(expected_beta);
    lastStable = expected_beta;
    lastRevision = expected_revision;
  }
  if (lastStable) assert.equal(lastStable, catalog.channels.stable, 'Stable promotion history does not reach the current Stable');
  return [...keep].sort();
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
      assert.ok(Number.isSafeInteger(object.lastModified) && object.lastModified > 0, 'Missing R2 last modified timestamp');
      objects.push({ key: object.key, bytes: object.bytes, etag: object.etag, lastModified: object.lastModified });
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

export async function verifyProtected(store, catalog, verify) {
  const manifests = new Map();
  for (const id of verify) {
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

function releaseBuild(key) {
  const match = releaseKey.exec(key);
  return match && !match[2].split('/').some(part => part === '.' || part === '..') ? match[1] : null;
}

function retention(catalog, objects) {
  const current = targets(catalog);
  const history = stableHistory(catalog);
  const keep = [...new Set([...current, ...history, ...snapshotProtected])].sort();
  const buildsInBucket = new Set(objects.map(object => /^releases\/([a-f0-9]{40})\//.exec(object.key)?.[1]));
  const missingHistory = history.filter(id => !current.includes(id) && !buildsInBucket.has(id));
  assert.ok(missingHistory.length <= 3 && missingHistory.every(id => snapshotKeep.has(id)), 'Unexpected missing historical Stable release');
  const verify = [...new Set([...current, ...history.filter(id => buildsInBucket.has(id))])].sort();
  const protectedBuilds = new Set(keep);
  const candidateEvidence = new Set(catalog.audit.eligible);
  const registrations = new Map(catalog.releases.map(row => [row.build_id, row]));
  const firstSwitch = catalog.audit.barriers[0]?.admittedAt;
  assert.ok(Number.isSafeInteger(firstSwitch) && firstSwitch > 0 && firstSwitch <= cutoff, 'Missing #609 exit-time evidence');
  const recentWrites = new Set(objects.filter(object => object.lastModified >= firstSwitch)
    .map(object => /^releases\/([a-f0-9]{40})\//.exec(object.key)?.[1]));
  const decisions = approvedBuilds.map(build => {
    const row = registrations.get(build);
    let reason = 'verified-superseded';
    if (protectedBuilds.has(build)) reason = 'protected';
    else if (!candidateEvidence.has(build)) reason = 'readmission-not-excluded';
    else if (row?.ready !== 1 || row.contract !== contract || !hash.test(row.manifest_digest)) reason = 'release-unverified';
    else if (!Number.isSafeInteger(row.published_at) || row.published_at <= 0 || row.published_at >= firstSwitch || recentWrites.has(build)) reason = 'recent-or-unknown-write';
    else if (!buildsInBucket.has(build)) reason = 'no-objects';
    return { build, reason };
  });
  return { keep, verify, missingHistory, decisions };
}

function classify(objects, decisions) {
  const eligible = new Set(decisions.filter(entry => entry.reason === 'verified-superseded').map(entry => entry.build));
  let count = 0, bytes = 0;
  const classified = objects.map(object => {
    const build = releaseBuild(object.key);
    const disposition = !build ? 'review' : approved.has(build) && eligible.has(build) ? 'delete' : 'keep';
    if (disposition === 'delete') {
      count++;
      bytes += object.bytes;
    }
    return { ...object, disposition };
  });
  assert.ok(count <= snapshotObjectCount && bytes <= snapshotBytes, 'Candidate inventory exceeds the authorized snapshot');
  return classified;
}

export async function previewCleanup(store, source) {
  assert.match(source ?? '', sha, 'Trusted control SHA required');
  const catalog = await store.catalog();
  const objects = await inventory(store);
  const protectedReleases = retention(catalog, objects);
  await verifyProtected(store, catalog, protectedReleases.verify);
  assert.deepEqual(await inventory(store), objects, 'Inventory changed during preview');
  assert.deepEqual(await store.catalog(), catalog, 'Channels/catalog changed during preview');
  return {
    version: 2, bucket: BUCKET, source, createdAt: new Date().toISOString(), catalog, ...protectedReleases,
    objects: classify(objects, protectedReleases.decisions),
  };
}

function validatePlan(plan, source) {
  assert.equal(plan.version, 2, 'A #609 preview is required');
  assert.equal(plan.bucket, BUCKET);
  assert.equal(plan.source, source, 'Controls changed; generate a new preview');
  const objects = plan.objects.map(({ key, bytes, etag, lastModified }) => ({ key, bytes, etag, lastModified }));
  const keys = new Set(objects.map(object => object.key));
  assert.equal(keys.size, objects.length, 'Duplicate plan object');
  const { keep, verify, missingHistory, decisions } = retention(plan.catalog, objects);
  assert.deepEqual({ keep: plan.keep, verify: plan.verify, missingHistory: plan.missingHistory, decisions: plan.decisions },
    { keep, verify, missingHistory, decisions }, 'Plan protection changed');
  assert.deepEqual(plan.objects, classify(objects, decisions), 'Plan classification changed');
}

function assertUnchangedInventory(current, plan) {
  const expected = new Map(plan.objects.map(object => [object.key, object]));
  for (const object of current) {
    const previous = expected.get(object.key);
    assert.ok(previous && previous.bytes === object.bytes && previous.etag === object.etag
      && previous.lastModified === object.lastModified, `Inventory changed: ${object.key}; generate a new preview`);
    expected.delete(object.key);
  }
  for (const object of expected.values()) assert.equal(object.disposition, 'delete', `Retained object missing: ${object.key}`);
}

export async function applyCleanup(store, plan, { source, journal = async () => {} }) {
  validatePlan(plan, source);
  const check = async () => {
    const current = await inventory(store);
    assertUnchangedInventory(current, plan);
    assert.deepEqual(await store.catalog(), plan.catalog, 'Channels/catalog changed; generate a new preview');
    return current;
  };
  await check();
  await verifyProtected(store, plan.catalog, plan.verify);
  const deleted = [], results = { deleted, pendingBatch: null, complete: false };
  await journal(results);
  const pending = plan.objects.filter(object => object.disposition === 'delete');
  for (let offset = 0; offset < pending.length; offset += 500) {
    const current = new Set((await check()).map(object => object.key));
    const keys = pending.slice(offset, offset + 500).map(object => object.key).filter(key => current.has(key));
    if (!keys.length) continue;
    results.pendingBatch = keys;
    await journal(results);
    // Partial failures are recorded before stopping. A retry accepts only missing planned deletions.
    const result = await store.deleteBatch(keys);
    results.lastBatch = result;
    results.pendingBatch = null;
    const acknowledged = new Set(result.deleted ?? []);
    assert.ok([...acknowledged].every(key => keys.includes(key)), 'Unexpected deletion acknowledgement');
    deleted.push(...acknowledged);
    await journal(results);
    assert.ok(!result.errors?.length && keys.every(key => acknowledged.has(key)), 'Partial R2 deletion; inspect journal, retry the same reviewed plan');
  }
  const remaining = await check();
  const plannedKeys = new Set(pending.map(object => object.key));
  assert.ok(!remaining.some(object => plannedKeys.has(object.key)), 'Planned objects remain');
  await verifyProtected(store, plan.catalog, plan.verify);
  assert.deepEqual(await store.catalog(), plan.catalog, 'Channels/catalog changed during final verification');
  results.complete = true;
  await journal(results);
  return results;
}

export function cleanupReport(plan) {
  const summarize = disposition => {
    const objects = plan.objects.filter(object => object.disposition === disposition);
    return `${objects.length} objects / ${objects.reduce((sum, object) => sum + object.bytes, 0)} bytes`;
  };
  const versions = new Map();
  for (const object of plan.objects.filter(object => object.disposition === 'delete')) {
    const build = releaseBuild(object.key);
    if (!versions.has(build)) versions.set(build, { count: 0, bytes: 0 });
    const total = versions.get(build);
    total.count++;
    total.bytes += object.bytes;
  }
  const skipped = plan.decisions.filter(entry => entry.reason !== 'verified-superseded');
  const { stable, beta, revision } = plan.catalog.channels;
  return [
    '# #609 前端清理预览', '',
    `- 桶 ${plan.bucket}`, `- Stable ${stable}`, `- Beta ${beta}`, `- revision ${revision}`,
    ...plan.catalog.audit.recent.map(entry => `- 最近已证实准入 ${entry.build} · Actions ${entry.run} / attempt ${entry.attempt}`),
    `- 待删除 ${summarize('delete')}（${versions.size} 个版本目录）`,
    `- 保留版本对象 ${summarize('keep')}`, `- 保留其他对象 ${summarize('review')}`,
    '', '## 已验证保留版本', '', ...plan.verify.map(build => `- ${build}`),
    '', '## 本轮开始时已无 R2 对象的历史 Stable', '', ...(plan.missingHistory.length ? plan.missingHistory.map(build => `- ${build}`) : ['无']),
    '', '## 待删除版本', '', ...(versions.size ? [...versions].map(([build, total]) => `- ${build} · ${total.count} objects / ${total.bytes} bytes`) : ['无']),
    '', '## 跳过的名单内版本', '', ...(skipped.length ? skipped.map(({ build, reason }) => `- ${build} · ${reason}`) : ['无']),
    '', '以 plan.json 中 disposition=delete 的对象键、大小、ETag 和时间戳为准。', '',
  ].join('\n');
}
