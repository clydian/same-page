import assert from 'node:assert/strict';
import { approvedBuilds, cutoff, switches } from './frontend-cleanup-609.mjs';

const sha = /^[a-f0-9]{40}$/;
const runId = /^[1-9][0-9]*$/;
const environment = 'production-release';

function timestamp(value) {
  const time = Date.parse(value);
  assert.ok(Number.isSafeInteger(time) && time > 0, 'Missing GitHub audit timestamp');
  return time;
}

async function ledger(get) {
  const records = [];
  const seen = new Set();
  for (let page = 1; page <= 5; page++) {
    const entries = await get(`/deployments?environment=${environment}&per_page=100&page=${page}`);
    assert.ok(Array.isArray(entries), 'Invalid production release ledger');
    for (const entry of entries) {
      const { id, sha: build, ref, payload } = entry;
      assert.ok(Number.isSafeInteger(id) && id > 0 && !seen.has(id), 'Invalid or repeated production deployment');
      assert.match(build ?? '', sha);
      assert.equal(ref, build);
      assert.equal(entry.environment, environment);
      assert.equal(entry.production_environment, true);
      assert.equal(payload?.artifact, `release-${build}`, 'Unrecognized production admission path');
      assert.match(payload?.runId ?? '', runId);
      const createdAt = timestamp(entry.created_at);
      assert.ok(!records.length || createdAt <= records.at(-1).createdAt, 'Release ledger order changed');
      records.push({ id, build, run: payload.runId, createdAt });
      seen.add(id);
      if (id === switches[0].deployment) return records;
    }
    if (entries.length < 100) break;
  }
  throw new Error('Incomplete production release ledger for #609');
}

async function admission(get, repository, record) {
  const base = `/actions/runs/${record.run}`;
  const [run, listing] = await Promise.all([get(base), get(`${base}/jobs?filter=all&per_page=100`)]);
  assert.equal(String(run.id), record.run);
  assert.equal(run.repository?.full_name, repository);
  assert.equal(run.head_repository?.full_name, repository);
  assert.equal(run.path, '.github/workflows/ci.yml');
  assert.equal(run.event, 'push');
  assert.equal(run.head_branch, 'main');
  assert.equal(run.head_sha, record.build);
  assert.ok(Array.isArray(listing.jobs) && listing.total_count === listing.jobs.length, 'Incomplete production run attempts');

  // Reruns retain the same run ID. Match this deployment to the job that
  // created it inside the locked GitHub release-admission step.
  const matches = listing.jobs.filter(job => job.name === 'deploy' && job.steps?.some(step =>
    step.name === 'Admit release under production lock'
      && Date.parse(step.started_at) <= record.createdAt && record.createdAt <= Date.parse(step.completed_at)));
  assert.equal(matches.length, 1, 'Cannot link production deployment to its exact attempt');
  const job = matches[0];
  assert.equal(String(job.run_id), record.run);
  assert.equal(job.head_sha, record.build);
  assert.ok(Number.isSafeInteger(job.run_attempt) && job.run_attempt > 0);
  const step = job.steps.find(step => step.name === 'Admit verified frontend to beta');
  assert.equal(step?.status, 'completed', 'Beta admission status is unknown');
  if (step.conclusion === 'skipped') return null;
  assert.equal(step.conclusion, 'success', 'Beta admission may have changed the channel without confirmation');
  const admittedAt = timestamp(step.completed_at);
  assert.ok(admittedAt >= record.createdAt, 'Invalid Beta admission order');
  return { deployment: record.id, build: record.build, run: record.run, attempt: job.run_attempt, admittedAt };
}

export async function readAdmissionAudit(get, repository, isAncestor) {
  const records = await ledger(get);
  const recent = [];
  const confirmed = new Map();
  const confirm = async record => {
    if (!confirmed.has(record.id)) confirmed.set(record.id, await admission(get, repository, record));
    return confirmed.get(record.id);
  };
  const barriers = [];
  for (const expected of switches) {
    const record = records.find(record => record.id === expected.deployment);
    assert.equal(record?.build, expected.build, 'Missing #609 Beta switch');
    const result = await confirm(record);
    assert.ok(result && result.admittedAt <= cutoff, '#609 Beta switch did not complete before the cutoff');
    barriers.push(result);
  }
  assert.ok(barriers[0].admittedAt < barriers[1].admittedAt && isAncestor(barriers[0].build, barriers[1].build), 'Invalid #609 Beta switch sequence');

  for (const record of records) {
    const result = await confirm(record);
    if (result && !recent.some(entry => entry.build === result.build)) recent.push(result);
    if (recent.length === 2) break;
  }
  assert.equal(recent.length, 2, 'Cannot establish the last two distinct Beta admissions');
  assert.ok(recent[0].admittedAt > recent[1].admittedAt, 'Recent Beta admissions out of order');
  const afterSwitch = new Set(records.map(record => record.build));
  const eligible = approvedBuilds.filter(build => !afterSwitch.has(build) && isAncestor(build, barriers[0].build));
  return { barriers, recent, afterSwitch: [...afterSwitch].sort(), eligible };
}
