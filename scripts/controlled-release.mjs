import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyRelease } from "./release-artifact.mjs";
import { admitRelease, recordReleaseStatus } from "./release-admission.mjs";

// One approved recovery, not a general arbitrary-ref deployment interface.
export const approvedRelease = Object.freeze({
  repository: "clydian/same-page", repositoryId: 1351049987,
  sha: "8909b335284dd4affebc4ce26bccf76f2439f6ef",
  runId: 39384186793, attempt: 1, workflowId: 345732692,
  artifactId: 12247185579, size: 14905652,
  digest: "17ec872271fdaf8ba3f2e72f755e7dbfe20c5dd63c296b026986c8552cd74d84",
});
const requiredJobs = ["scope", "checks", "backend", "build", "platform", "verify",
  "visual (1)", "visual (2)", "visual (3)", "visual (4)", "smoke (1)", "smoke (2)", "smoke (3)"];

export function validateContext(env) {
  assert.equal(env.GITHUB_EVENT_NAME, "workflow_dispatch", "manual dispatch required");
  assert.equal(env.GITHUB_REPOSITORY, approvedRelease.repository);
  assert.equal(env.GITHUB_REPOSITORY_ID, String(approvedRelease.repositoryId));
  assert.equal(env.GITHUB_REF, "refs/heads/main", "dispatch must use main");
  assert.equal(env.RELEASE_CONFIRMATION, approvedRelease.sha, "confirm the approved full SHA");
  assert.match(env.GITHUB_SHA ?? "", /^[a-f0-9]{40}$/);
  assert.match(env.GITHUB_RUN_ID ?? "", /^\d+$/);
}

export function validateSource({ run, jobs, artifact }, now = Date.now()) {
  const p = approvedRelease;
  for (const repo of [run.repository, run.head_repository]) {
    assert.equal(repo?.id, p.repositoryId, "source repository mismatch");
    assert.equal(repo?.full_name, p.repository);
  }
  assert.equal(run.id, p.runId); assert.equal(run.run_attempt, p.attempt);
  assert.equal(run.workflow_id, p.workflowId); assert.equal(run.path, ".github/workflows/ci.yml");
  assert.equal(run.head_sha, p.sha); assert.equal(run.head_branch, "main");
  assert.equal(run.event, "push"); assert.equal(run.status, "completed"); assert.equal(run.conclusion, "success");
  assert.equal(jobs.total_count, requiredJobs.length + 1, "incomplete or unexpected CI job set");
  assert.equal(jobs.jobs?.length, jobs.total_count, "CI job pagination must be complete");
  assert.deepEqual(jobs.jobs.map(job => job.name).sort(), [...requiredJobs, "deploy"].sort());
  for (const job of jobs.jobs) {
    assert.equal(job.run_id, p.runId); assert.equal(job.head_sha, p.sha);
    assert.equal(job.status, "completed");
    assert.equal(job.conclusion, job.name === "deploy" ? "skipped" : "success", `CI job ${job.name} is not approved`);
  }
  assert.equal(artifact.id, p.artifactId); assert.equal(artifact.name, `release-${p.sha}`);
  assert.equal(artifact.expired, false); assert.ok(Date.parse(artifact.expires_at) > now, "artifact expired");
  assert.equal(artifact.size_in_bytes, p.size); assert.equal(artifact.digest, `sha256:${p.digest}`);
  assert.deepEqual(artifact.workflow_run, {
    id: p.runId, repository_id: p.repositoryId, head_repository_id: p.repositoryId,
    head_branch: "main", head_sha: p.sha,
  });
}

export async function validateFromGitHub(env, fetchImpl = fetch) {
  validateContext(env); // Reject inputs before any authenticated request.
  assert.ok(env.GITHUB_TOKEN, "ephemeral GitHub token required");
  const get = async suffix => {
    const response = await fetchImpl(`https://api.github.com/repos/${approvedRelease.repository}/actions/${suffix}`, {
      headers: { authorization: `Bearer ${env.GITHUB_TOKEN}`, accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      redirect: "error", signal: AbortSignal.timeout(15_000),
    });
    assert.ok(response.ok, `source validation failed: HTTP ${response.status}`);
    return response.json();
  };
  const attempt = `runs/${approvedRelease.runId}/attempts/${approvedRelease.attempt}`;
  const run = await get(attempt);
  const jobs = await get(`${attempt}/jobs?per_page=100`);
  const artifact = await get(`artifacts/${approvedRelease.artifactId}`);
  validateSource({ run, jobs, artifact });
}

export function verifyArchive(file) {
  assert.ok(statSync(file).isFile(), "expected original artifact ZIP");
  assert.equal(statSync(file).size, approvedRelease.size, "artifact ZIP size mismatch");
  assert.equal(createHash("sha256").update(readFileSync(file)).digest("hex"), approvedRelease.digest, "artifact ZIP digest mismatch");
}

export async function verifyExtractedRelease(cwd) {
  const manifest = await verifyRelease({ cwd, sha: approvedRelease.sha });
  assert.equal(manifest.runId, String(approvedRelease.runId), "release must come from the approved CI run");
  return manifest;
}

export async function admitControlledRelease({ cwd, env, fetchImpl = fetch, output = env.GITHUB_OUTPUT }) {
  validateContext(env);
  assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim(), approvedRelease.sha);
  await verifyExtractedRelease(cwd);
  // Explicit target SHA: GITHUB_SHA remains the workflow/control commit.
  const options = { cwd, sha: approvedRelease.sha, runId: env.GITHUB_RUN_ID,
    repository: approvedRelease.repository, token: env.GITHUB_TOKEN, fetchImpl };
  // The deployment payload identifies the original CI artifact; status log URLs
  // identify this manual run. They are deliberately different provenance IDs.
  const result = await admitRelease({ ...options, runId: String(approvedRelease.runId) });
  assert.ok(result.proceed, `approved release superseded by ${result.previous}; refusing downgrade`);
  // Persist the ID before writing in_progress so a failed status write is finalized.
  appendFileSync(output, `deployment_id=${result.deploymentId}\n`);
  await recordReleaseStatus({ ...options, deploymentId: result.deploymentId, state: "in_progress" });
  return result;
}

const here = path.dirname(fileURLToPath(import.meta.url));
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , command, first, second] = process.argv;
  if (command === "validate") {
    await validateFromGitHub(process.env);
    console.log(`Validated CI ${approvedRelease.runId}, artifact ${approvedRelease.artifactId}, source ${approvedRelease.sha}`);
  } else if (command === "stage") {
    const entries = readdirSync(first);
    assert.equal(entries.length, 1, "expected exactly one original ZIP");
    const file = path.join(first, entries[0]);
    verifyArchive(file);
    mkdirSync(second, { recursive: true });
    renameSync(file, path.join(second, "source.zip"));
  } else if (command === "extract") {
    verifyArchive(first); // Both jobs enforce the approved original digest.
    execFileSync("python3", [path.join(here, "extract-controlled-release.py"), first, second], { stdio: "inherit" });
    await verifyExtractedRelease(second);
  } else if (command === "admit") {
    await admitControlledRelease({ cwd: path.resolve(first), env: process.env });
  } else if (command === "verify") {
    await verifyExtractedRelease(first);
  } else if (command === "status") {
    validateContext(process.env);
    await recordReleaseStatus({ deploymentId: process.env.DEPLOYMENT_ID, state: process.env.RELEASE_STATE,
      runId: process.env.GITHUB_RUN_ID, repository: approvedRelease.repository, token: process.env.GITHUB_TOKEN });
  } else throw new Error("usage: controlled-release.mjs validate|stage|extract|admit|verify|status");
}
