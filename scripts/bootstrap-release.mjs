import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyRelease } from "./release-artifact.mjs";
import { assertStorageCompatibility } from "./release-contract.mjs";
import { admitRelease, recordReleaseStatus } from "./release-admission.mjs";
import { verifyCompatibilityReport } from "./frontend-release.mjs";

const repository = "clydian/same-page", repositoryId = 1351049987, workflowId = 345732692;
const origin = "https://samepage.clyapps.com";
const jobsRequired = ["scope", "checks", "backend", "build", "platform", "verify", "visual (1)", "visual (2)", "visual (3)", "visual (4)", "smoke (1)", "smoke (2)", "smoke (3)", "deploy"];
const shaPattern = /^[a-f0-9]{40}$/;
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
function positiveId(value) { assert.match(String(value ?? ""), /^[1-9]\d*$/); assert.ok(Number.isSafeInteger(Number(value))); return Number(value); }

export function validateBootstrapContext(env) {
  assert.equal(env.GITHUB_EVENT_NAME, "workflow_dispatch", "manual main dispatch required");
  assert.equal(env.GITHUB_REPOSITORY, repository);
  assert.equal(env.GITHUB_REPOSITORY_ID, String(repositoryId));
  assert.equal(env.GITHUB_REF, "refs/heads/main");
  assert.match(env.GITHUB_SHA ?? "", shaPattern);
  assert.equal(env.RELEASE_CONFIRMATION, env.GITHUB_SHA, "confirm the exact control/source SHA");
  assert.ok(["", "false"].includes(env.CHANNEL_ROUTING_ENABLED ?? ""), "bootstrap is unavailable after channel activation");
  positiveId(env.GITHUB_RUN_ID);
}

export function validateCiEvidence({ run, jobs, artifact }, { sha, runId, bridge }, now = Date.now()) {
  assert.match(sha, shaPattern); positiveId(runId);
  for (const repo of [run.repository, run.head_repository]) {
    assert.equal(repo?.id, repositoryId); assert.equal(repo?.full_name, repository);
  }
  assert.equal(run.id, Number(runId)); assert.equal(run.run_attempt, 1, "use a new commit, not a rebuilt CI attempt");
  assert.equal(run.workflow_id, workflowId); assert.equal(run.path, ".github/workflows/ci.yml");
  assert.equal(run.event, "push"); assert.equal(run.head_branch, "main"); assert.equal(run.head_sha, sha);
  assert.equal(run.status, "completed"); assert.equal(run.conclusion, "success");
  assert.equal(jobs.total_count, jobsRequired.length); assert.equal(jobs.jobs?.length, jobsRequired.length);
  assert.deepEqual(jobs.jobs.map(job => job.name).sort(), [...jobsRequired].sort());
  for (const job of jobs.jobs) {
    assert.equal(job.run_id, run.id); assert.equal(job.head_sha, sha); assert.equal(job.status, "completed");
    if (bridge) assert.equal(job.conclusion, job.name === "deploy" ? "skipped" : "success", `bridge CI ${job.name}`);
    else if (["scope", "build", "verify", "deploy"].includes(job.name)) assert.equal(job.conclusion, "success", `legacy CI ${job.name}`);
    else assert.ok(["success", "skipped"].includes(job.conclusion), `legacy CI ${job.name}`);
  }
  positiveId(artifact.id);
  assert.equal(artifact.name, `release-${sha}`); assert.equal(artifact.expired, false);
  assert.ok(Date.parse(artifact.expires_at) > now, "original artifact expired");
  assert.ok(Number.isSafeInteger(artifact.size_in_bytes) && artifact.size_in_bytes > 0 && artifact.size_in_bytes <= 512 * 1024 * 1024);
  assert.match(artifact.digest ?? "", /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(artifact.workflow_run, { id: run.id, repository_id: repositoryId, head_repository_id: repositoryId, head_branch: "main", head_sha: sha });
  return { sha, runId: run.id, attempt: 1, artifactId: artifact.id, size: artifact.size_in_bytes, digest: artifact.digest.slice(7) };
}

export function validatePlan(plan, env) {
  validateBootstrapContext(env);
  assert.equal(plan.version, 1); assert.equal(plan.repository, repository);
  assert.equal(plan.source.sha, env.GITHUB_SHA);
  assert.equal(plan.source.runId, positiveId(env.CI_RUN_ID));
  assert.equal(plan.legacy.runId, positiveId(env.LEGACY_RUN_ID));
  assert.equal(plan.legacy.sha, env.LEGACY_SHA);
  assert.notEqual(plan.source.sha, plan.legacy.sha, "legacy and bridge must be distinct original builds");
  for (const release of [plan.source, plan.legacy]) {
    assert.match(release.sha, shaPattern); positiveId(release.runId); positiveId(release.artifactId);
    assert.equal(release.attempt, 1); assert.match(release.digest, /^[a-f0-9]{64}$/);
    assert.ok(Number.isSafeInteger(release.size) && release.size > 0 && release.size <= 512 * 1024 * 1024);
  }
  return plan;
}

export async function bootstrapPlan(env, fetchImpl = fetch) {
  validateBootstrapContext(env); // All inputs fail before using either credential or network.
  const sourceRun = positiveId(env.CI_RUN_ID), legacyRun = positiveId(env.LEGACY_RUN_ID);
  assert.match(env.LEGACY_SHA ?? "", shaPattern); assert.notEqual(env.LEGACY_SHA, env.GITHUB_SHA);
  assert.ok(env.GITHUB_TOKEN, "ephemeral read token required");
  const get = async suffix => {
    const response = await fetchImpl(`https://api.github.com/repos/${repository}/actions/${suffix}`, {
      headers: { authorization: `Bearer ${env.GITHUB_TOKEN}`, accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      redirect: "error", signal: AbortSignal.timeout(15000), cache: "no-store",
    });
    assert.ok(response.ok, `CI evidence unavailable: HTTP ${response.status}`); return response.json();
  };
  const source = async (runId, sha, bridge) => {
    // Check the latest attempt too: a later rerun can replace this run's ZIP.
    // Reading only /attempts/1 would hide that replacement behind old success.
    const run = await get(`runs/${runId}`);
    const jobs = await get(`runs/${runId}/attempts/1/jobs?per_page=100`);
    const artifacts = await get(`runs/${runId}/artifacts?per_page=100`);
    assert.ok(artifacts.total_count <= 100 && artifacts.artifacts?.length === artifacts.total_count, "artifact pagination incomplete");
    const matching = artifacts.artifacts.filter(item => item.name === `release-${sha}`);
    assert.equal(matching.length, 1, "one exact original release artifact required");
    return validateCiEvidence({ run, jobs, artifact: matching[0] }, { sha, runId, bridge });
  };
  return validatePlan({ version: 1, repository,
    source: await source(sourceRun, env.GITHUB_SHA, true),
    legacy: await source(legacyRun, env.LEGACY_SHA, false) }, env);
}

export function verifyOriginalZip(file, release) {
  assert.ok(statSync(file).isFile()); assert.equal(statSync(file).size, release.size, "original ZIP size mismatch");
  assert.equal(digest(readFileSync(file)), release.digest, "original ZIP digest mismatch");
}

export async function verifyBootstrapRelease(cwd, release, bridge) {
  const seal = await verifyRelease({ cwd, sha: release.sha });
  assert.equal(seal.runId, String(release.runId), "sealed run identity mismatch");
  const build = JSON.parse(readFileSync(path.join(cwd, "dist/client/build.json"), "utf8"));
  assert.equal(build.assetBase, bridge ? `/_releases/${release.sha}/` : "/", "wrong bootstrap build mode");
  return seal;
}

export async function verifyLegacyTransition(plan, sourceDir, legacyDir, verifyStorage) {
  const source = await verifyBootstrapRelease(sourceDir, plan.source, true);
  const legacy = await verifyBootstrapRelease(legacyDir, plan.legacy, false);
  const migrations = seal => Object.fromEntries(Object.entries(seal.files).filter(([name]) => name.startsWith("migrations/")));
  assert.deepEqual(migrations(source), migrations(legacy), "bootstrap must not introduce database migrations");
  const contract = dir => JSON.parse(readFileSync(path.join(dir, "dist/release-storage.json"), "utf8"));
  assertStorageCompatibility(contract(legacyDir), contract(sourceDir));
  const probe = (dir, id) => { const bytes = readFileSync(path.join(dir, "dist/release-storage-probe.js")); return { id, bytes, digest: digest(bytes) }; };
  return verifyStorage({ stable: probe(legacyDir, plan.legacy.sha), candidate: probe(sourceDir, plan.source.sha) });
}

export function verifyTransitionEvidence(plan, sourceDir, legacyDir, report) {
  const probeDigest = dir => digest(readFileSync(path.join(dir, "dist/release-storage-probe.js")));
  verifyCompatibilityReport(report, { stable: plan.legacy.sha, candidate: plan.source.sha,
    stableProbe: probeDigest(legacyDir), candidateProbe: probeDigest(sourceDir) });
}

export async function checkBootstrapProduction(plan, fetchImpl = fetch) {
  const response = await fetchImpl(`${origin}/api/health`, { redirect: "error", signal: AbortSignal.timeout(15000), cache: "no-store" });
  assert.ok(response.ok, "cannot read production identity");
  const health = await response.json();
  assert.ok([plan.legacy.sha, plan.source.sha].includes(health.buildId), "production moved; do not overwrite another release");
  return health.buildId;
}

export async function admitBootstrap({ plan, sourceDir, cwd, env, fetchImpl = fetch, output = env.GITHUB_OUTPUT }) {
  validatePlan(plan, env);
  assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim(), plan.source.sha);
  await verifyBootstrapRelease(sourceDir, plan.source, true);
  await checkBootstrapProduction(plan, fetchImpl);
  const options = { cwd, sha: plan.source.sha, repository, token: env.GITHUB_TOKEN, fetchImpl };
  const admission = await admitRelease({ ...options, runId: String(plan.source.runId) });
  assert.ok(admission.proceed, "bootstrap superseded; refusing downgrade");
  appendFileSync(output, `deployment_id=${admission.deploymentId}\n`);
  await recordReleaseStatus({ ...options, deploymentId: admission.deploymentId, runId: env.GITHUB_RUN_ID, state: "in_progress" });
  return admission;
}

const here = path.dirname(fileURLToPath(import.meta.url));
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, planPath, ...args] = process.argv.slice(2);
  const env = process.env;
  if (command === "validate") {
    const plan = await bootstrapPlan(env);
    mkdirSync(path.dirname(planPath), { recursive: true }); writeFileSync(planPath, JSON.stringify(plan, null, 2) + "\n");
    appendFileSync(env.GITHUB_OUTPUT, `source_artifact_id=${plan.source.artifactId}\nlegacy_artifact_id=${plan.legacy.artifactId}\n`);
    console.log(`Pinned bridge ${plan.source.sha}, CI ${plan.source.runId}, original ZIP ${plan.source.digest}; legacy ${plan.legacy.sha}`);
  } else {
    const plan = validatePlan(JSON.parse(readFileSync(planPath, "utf8")), env);
    if (command === "stage") {
      const [kind, incoming, destination] = args; assert.ok(["source", "legacy"].includes(kind));
      const files = readdirSync(incoming); assert.equal(files.length, 1);
      const file = path.join(incoming, files[0]); verifyOriginalZip(file, plan[kind]);
      mkdirSync(path.dirname(destination), { recursive: true }); renameSync(file, destination);
    } else if (command === "extract") {
      const [sourceZip, legacyZip, sourceDir, legacyDir] = args;
      verifyOriginalZip(sourceZip, plan.source); verifyOriginalZip(legacyZip, plan.legacy);
      for (const [zip, destination, release, bridge] of [[sourceZip, sourceDir, plan.source, true], [legacyZip, legacyDir, plan.legacy, false]]) {
        mkdirSync(destination, { recursive: true });
        execFileSync("python3", [path.join(here, "extract-controlled-release.py"), zip, destination], { stdio: "inherit" });
        await verifyBootstrapRelease(destination, release, bridge);
      }
    } else if (command === "transition") {
      const { verifyArtifactStorage } = await import("./verify-release-storage.mjs");
      const report = await verifyLegacyTransition(plan, args[0], args[1], verifyArtifactStorage);
      mkdirSync("artifacts/verification", { recursive: true });
      writeFileSync("artifacts/verification/bootstrap-transition.json", JSON.stringify(report, null, 2) + "\n");
      console.log(`Verified actual legacy ${plan.legacy.sha} → bridge ${plan.source.sha} → legacy → bridge in Chromium/WebKit`);
    } else if (command === "preflight") {
      const report = JSON.parse(readFileSync(path.join(path.dirname(planPath), "transition.json"), "utf8"));
      verifyTransitionEvidence(plan, args[0], args[1], report);
      console.log(`Confirmed production ${await checkBootstrapProduction(plan)}`);
    } else if (command === "admit") {
      await admitBootstrap({ plan, sourceDir: path.resolve(args[0]), cwd: process.cwd(), env });
    } else if (command === "status") {
      await recordReleaseStatus({ deploymentId: env.DEPLOYMENT_ID, state: env.RELEASE_STATE,
        repository, token: env.GITHUB_TOKEN, runId: env.GITHUB_RUN_ID });
    } else throw new Error("usage: bootstrap-release.mjs validate|stage|extract|transition|preflight|admit|status PLAN ...");
  }
}
