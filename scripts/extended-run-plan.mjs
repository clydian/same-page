import assert from 'node:assert/strict';
import { appendFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Read the original attempt, not the latest attempt of a re-run workflow.
export async function wasBetaAdmitted({ repository, runId, attempt, token, fetchImpl = fetch }) {
  assert.match(repository ?? '', /^[\w.-]+\/[\w.-]+$/);
  assert.ok(Number.isSafeInteger(runId) && runId > 0 && Number.isSafeInteger(attempt) && attempt > 0);
  assert.ok(token);
  const response = await fetchImpl(`https://api.github.com/repos/${repository}/actions/runs/${runId}/attempts/${attempt}/jobs?per_page=100`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    signal: AbortSignal.timeout(15000),
  });
  assert.ok(response.ok, `cannot read source run jobs: HTTP ${response.status}`);
  const data = await response.json();
  assert.ok(Array.isArray(data.jobs) && data.total_count === data.jobs.length, 'source jobs missing or paginated');
  const deploy = data.jobs.filter(job => job.name === 'deploy');
  if (deploy.length !== 1 || deploy[0].conclusion !== 'success') return false;
  const admit = deploy[0].steps?.filter(step => step.name === 'Admit verified frontend to beta');
  return admit?.length === 1 && admit[0].conclusion === 'success';
}

export async function sourceArtifact({ repository, runId, sha, token, fetchImpl = fetch }) {
  assert.match(repository ?? '', /^[\w.-]+\/[\w.-]+$/);
  assert.ok(Number.isSafeInteger(runId) && runId > 0 && token);
  assert.match(sha ?? '', /^[a-f0-9]{40}$/);
  const name = `release-${sha}`;
  const response = await fetchImpl(`https://api.github.com/repos/${repository}/actions/runs/${runId}/artifacts?name=${name}&per_page=100`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    signal: AbortSignal.timeout(15000),
  });
  assert.ok(response.ok, `cannot read source artifacts: HTTP ${response.status}`);
  const data = await response.json();
  assert.ok(Array.isArray(data.artifacts) && data.total_count === data.artifacts.length, 'source artifacts missing or paginated');
  const matches = data.artifacts.filter(item => item.name === name && !item.expired);
  assert.equal(matches.length, 1, 'expected one unexpired candidate artifact');
  assert.ok(Number.isSafeInteger(matches[0].id) && matches[0].id > 0);
  return matches[0].id;
}

async function main() {
  const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const run = event.workflow_run;
  const allowed = run?.event === 'push' && run.head_branch === 'main' && run.conclusion === 'success' &&
    run.head_repository?.full_name === process.env.GITHUB_REPOSITORY && /^[a-f0-9]{40}$/.test(run.head_sha ?? '');
  const proceed = allowed && await wasBetaAdmitted({ repository: process.env.GITHUB_REPOSITORY, runId: run.id, attempt: run.run_attempt, token: process.env.GITHUB_TOKEN });
  const artifact = proceed ? await sourceArtifact({ repository: process.env.GITHUB_REPOSITORY, runId: run.id, sha: run.head_sha, token: process.env.GITHUB_TOKEN }) : null;
  await appendFile(process.env.GITHUB_OUTPUT, `proceed=${!!proceed}\n${artifact ? `artifact=${artifact}\n` : ''}`);
  console.log(proceed ? `Run post-beta verification for ${run.head_sha}` : 'Source CI did not admit a beta; skip extended checks.');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
