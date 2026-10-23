import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { bootstrapPlan, validateBootstrapContext, validateCiEvidence, validatePlan, verifyOriginalZip, verifyBootstrapRelease, verifyLegacyTransition, verifyTransitionEvidence, checkBootstrapProduction, admitBootstrap } from "./bootstrap-release.mjs";
import { storageContractFiles } from "./release-contract.mjs";
import { sealRelease } from "./release-artifact.mjs";

const sha = "a".repeat(40), old = "b".repeat(40);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const env = () => ({ GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REPOSITORY: "clydian/same-page", GITHUB_REPOSITORY_ID: "1351049987", GITHUB_REF: "refs/heads/main", GITHUB_SHA: sha, GITHUB_RUN_ID: "300", CI_RUN_ID: "100", LEGACY_RUN_ID: "200", LEGACY_SHA: old, RELEASE_CONFIRMATION: sha, GITHUB_TOKEN: "ephemeral-test" });
const release = (id, runId) => ({ sha: id, runId, attempt: 1, artifactId: runId + 1000, size: 3, digest: hash("zip") });
const plan = () => ({ version: 1, repository: "clydian/same-page", source: release(sha, 100), legacy: release(old, 200) });
function evidence(id = sha, runId = 100, bridge = true) {
  const names = ["scope", "checks", "backend", "build", "platform", "verify", "visual (1)", "visual (2)", "visual (3)", "visual (4)", "smoke (1)", "smoke (2)", "smoke (3)", "deploy"];
  const repo = { full_name: "clydian/same-page", id: 1351049987 };
  return {
    run: { id: runId, repository: repo, head_repository: repo, run_attempt: 1, workflow_id: 345732692, path: ".github/workflows/ci.yml", event: "push", head_branch: "main", head_sha: id, status: "completed", conclusion: "success" },
    jobs: { total_count: 14, jobs: names.map(name => ({ name, run_id: runId, head_sha: id, status: "completed", conclusion: bridge && name === "deploy" ? "skipped" : "success" })) },
    artifact: { id: runId + 1000, name: `release-${id}`, expired: false, expires_at: "2100-01-01T00:00:00Z", size_in_bytes: 3, digest: `sha256:${hash("zip")}`, workflow_run: { id: runId, repository_id: repo.id, head_repository_id: repo.id, head_branch: "main", head_sha: id } },
  };
}
const directories = [];
function directory() { const value = mkdtempSync(path.join(tmpdir(), "same-page-bootstrap-test-")); directories.push(value); return value; }
afterEach(() => directories.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));

it("rejects unapproved dispatches and malformed inputs before using a token", async () => {
  expect(() => validateBootstrapContext(env())).not.toThrow();
  for (const patch of [{ GITHUB_EVENT_NAME: "push" }, { GITHUB_REPOSITORY: "fork/same-page" }, { GITHUB_REPOSITORY_ID: "1" }, { GITHUB_REF: "refs/heads/other" }, { RELEASE_CONFIRMATION: "main" }, { CHANNEL_ROUTING_ENABLED: "true" }, { CHANNEL_ROUTING_ENABLED: "TRUE" }, { CI_RUN_ID: "1;echo unsafe" }, { LEGACY_SHA: sha }]) {
    const fetchImpl = vi.fn();
    await expect(bootstrapPlan({ ...env(), ...patch }, fetchImpl)).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  }
  for (const patch of [{ source: { ...plan().source, runId: 999 } }, { legacy: { ...plan().legacy, sha } }, { repository: "fork/same-page" }]) expect(() => validatePlan({ ...plan(), ...patch }, env())).toThrow();
});

it("requires the complete successful first bridge CI and deployed legacy CI", () => {
  expect(validateCiEvidence(evidence(), { sha, runId: 100, bridge: true })).toEqual(plan().source);
  const legacy = evidence(old, 200, false); legacy.jobs.jobs.find(job => job.name === "backend").conclusion = "skipped";
  expect(validateCiEvidence(legacy, { sha: old, runId: 200, bridge: false })).toEqual(plan().legacy);
  for (const [key, value] of Object.entries({ id: 999, run_attempt: 2, workflow_id: 999, event: "pull_request", head_branch: "branch", status: "in_progress", conclusion: "failure", repository: {}, head_repository: {} })) {
    const data = evidence(); data.run[key] = value;
    expect(() => validateCiEvidence(data, { sha, runId: 100, bridge: true })).toThrow();
  }
  for (const mutation of [data => data.jobs.jobs.pop(), data => data.jobs.jobs[0].name = "checks", data => data.jobs.jobs[0].conclusion = "skipped", data => data.jobs.jobs[0].head_sha = old, data => data.jobs.jobs.at(-1).conclusion = "success", data => data.artifact.expired = true, data => data.artifact.digest = "unsealed", data => data.artifact.workflow_run.head_sha = old]) {
    const data = evidence(); mutation(data);
    expect(() => validateCiEvidence(data, { sha, runId: 100, bridge: true })).toThrow();
  }
});

it("pins both original ZIP identities through read-only fixed GitHub endpoints", async () => {
  const responses = [evidence(), evidence(old, 200, false)].flatMap(({ run, jobs, artifact }) => [run, jobs, { total_count: 1, artifacts: [artifact] }]);
  const fetchImpl = vi.fn(async () => Response.json(responses.shift()));
  await expect(bootstrapPlan(env(), fetchImpl)).resolves.toEqual(plan());
  expect(fetchImpl).toHaveBeenCalledTimes(6);
  expect(fetchImpl.mock.calls[0][0]).toBe("https://api.github.com/repos/clydian/same-page/actions/runs/100");
  expect(fetchImpl.mock.calls[3][0]).toBe("https://api.github.com/repos/clydian/same-page/actions/runs/200");
  for (const [url, options] of fetchImpl.mock.calls) {
    expect(url).toMatch(/^https:\/\/api\.github\.com\/repos\/clydian\/same-page\/actions\//);
    expect(options).toMatchObject({ redirect: "error", cache: "no-store" });
  }
  await expect(bootstrapPlan(env(), async () => new Response(null, { status: 403 }))).rejects.toThrow("HTTP 403");
});

it("rejects a same-size ZIP replacement", () => {
  const file = path.join(directory(), "source.zip"); writeFileSync(file, "zip");
  expect(() => verifyOriginalZip(file, plan().source)).not.toThrow();
  writeFileSync(file, "bad"); expect(() => verifyOriginalZip(file, plan().source)).toThrow(/digest/);
});

it("rejects a rebuilt run even when its first attempt remains successful", async () => {
  const fetchImpl = async url => {
    const data = url.includes("/runs/200") ? evidence(old, 200, false) : evidence();
    if (url.endsWith("/artifacts?per_page=100")) return Response.json({ total_count: 1, artifacts: [data.artifact] });
    if (url.includes("/jobs?")) return Response.json(data.jobs);
    return Response.json({ ...data.run, run_attempt: url.endsWith("/runs/100") ? 2 : 1 });
  };
  await expect(bootstrapPlan(env(), fetchImpl)).rejects.toThrow(/new commit/);
});

async function artifact(id, runId, bridge, patch = {}) {
  const cwd = directory();
  const contract = { contract: "same-page-storage-v15-sync-v1", dexie: "4.4.5", zod: "4.6.2", files: Object.fromEntries(storageContractFiles.map(file => [file, hash(file)])), ...patch };
  const base = bridge ? `/_releases/${id}/` : "/";
  for (const folder of ["dist/client/assets", "dist/same_page", "migrations"]) mkdirSync(path.join(cwd, folder), { recursive: true });
  const files = { "dist/client/assets/app.js": "app", "dist/client/build.json": JSON.stringify({ buildId: id, assetBase: base, scripts: { [base + "assets/app.js"]: hash("app") } }), "dist/client/index.html": `<meta name="same-page-build-id" content="${id}">`, "dist/same_page/index.js": id, "dist/release-storage.json": JSON.stringify(contract), "dist/release-storage-probe.js": `probe-${id}`, "migrations/0034.sql": "SELECT 1;", "wrangler.jsonc": "{}", "package-lock.json": "{}" };
  for (const [file, bytes] of Object.entries(files)) writeFileSync(path.join(cwd, file), bytes);
  await sealRelease({ cwd, sha: id, runId: String(runId) }); return cwd;
}

it("verifies sealed provenance and runs the actual old probe against the new probe", async () => {
  const sourceDir = await artifact(sha, 100, true), legacyDir = await artifact(old, 200, false);
  const verifyStorage = vi.fn(async value => value);
  const result = await verifyLegacyTransition(plan(), sourceDir, legacyDir, verifyStorage);
  expect(result.stable).toMatchObject({ id: old, bytes: Buffer.from(`probe-${old}`) });
  expect(result.candidate).toMatchObject({ id: sha, bytes: Buffer.from(`probe-${sha}`) });
  const report = { version: 1, passed: true, stable: old, candidate: sha, stableProbe: hash(`probe-${old}`), candidateProbe: hash(`probe-${sha}`), engines: ["chromium", "webkit"] };
  expect(() => verifyTransitionEvidence(plan(), sourceDir, legacyDir, report)).not.toThrow();
  for (const patch of [{ passed: false }, { stable: sha }, { candidateProbe: hash("other bytes") }, { engines: ["chromium"] }]) {
    expect(() => verifyTransitionEvidence(plan(), sourceDir, legacyDir, { ...report, ...patch })).toThrow();
  }
  await expect(verifyBootstrapRelease(sourceDir, { ...plan().source, runId: 101 }, true)).rejects.toThrow(/run identity/);
  await expect(verifyBootstrapRelease(sourceDir, plan().source, false)).rejects.toThrow(/build mode/);
  writeFileSync(path.join(sourceDir, "migrations/0034.sql"), "SELECT 2;");
  await sealRelease({ cwd: sourceDir, sha, runId: "100" });
  await expect(verifyLegacyTransition(plan(), sourceDir, legacyDir, verifyStorage)).rejects.toThrow(/database migrations/);
  expect(verifyStorage).toHaveBeenCalledTimes(1);
});

it("rejects a changed storage boundary before running browsers", async () => {
  const sourceDir = await artifact(sha, 100, true, { dexie: "5.0.0" }), legacyDir = await artifact(old, 200, false);
  const verifyStorage = vi.fn();
  await expect(verifyLegacyTransition(plan(), sourceDir, legacyDir, verifyStorage)).rejects.toThrow(/dexie/);
  expect(verifyStorage).not.toHaveBeenCalled();
});

it("allows only the recorded production baseline or an exact bridge retry", async () => {
  for (const buildId of [old, sha]) await expect(checkBootstrapProduction(plan(), async () => Response.json({ buildId }))).resolves.toBe(buildId);
  await expect(checkBootstrapProduction(plan(), async () => Response.json({ buildId: "c".repeat(40) }))).rejects.toThrow(/production moved/);
  const fetchImpl = vi.fn();
  await expect(admitBootstrap({ plan: plan(), sourceDir: directory(), cwd: process.cwd(), env: { ...env(), RELEASE_CONFIRMATION: old }, fetchImpl })).rejects.toThrow();
  expect(fetchImpl).not.toHaveBeenCalled();
});

it("keeps source validation unprivileged and stops production at the mobile gate", () => {
  const workflow = readFileSync(".github/workflows/bootstrap-release-channels.yml", "utf8");
  const [validation, production] = workflow.split("  production:\n");
  expect(validation).toContain("      actions: read");
  expect(validation).not.toContain("secrets."); expect(validation).not.toContain("environment: production");
  expect(production).toContain("group: same-page-production"); expect(production).toContain("environment: production");
  expect(production).toContain("permissions:\n      contents: read\n      deployments: write");
  expect(production).not.toContain("github-token:"); expect(production).not.toContain("actions: read");
  expect(production).toContain("--var RELEASE_CHANNELS_ENABLED:false");
  expect(production.indexOf("initialize \"$GITHUB_SHA\"")).toBeGreaterThan(production.indexOf("verify-deployment.mjs"));
  expect(production.indexOf("verify-bootstrap-online.mjs")).toBeGreaterThan(production.indexOf("initialize \"$GITHUB_SHA\""));
  expect(workflow).not.toMatch(/RELEASE_CHANNELS_ENABLED:true|variable set|npm run build|GITHUB_SHA:/);
  expect(workflow).not.toMatch(/run:.*\$\{\{ inputs\./);
});
