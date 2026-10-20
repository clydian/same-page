import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { approvedRelease as p, validateContext, validateSource, validateFromGitHub, verifyArchive, verifyExtractedRelease, admitControlledRelease } from "./controlled-release.mjs";
import { sealRelease } from "./release-artifact.mjs";

const directories = [];
const temp = () => { const dir = mkdtempSync(path.join(tmpdir(), "same-page-controlled-")); directories.push(dir); return dir; };
afterEach(() => directories.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));
const env = () => ({ GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REPOSITORY: p.repository,
  GITHUB_REPOSITORY_ID: String(p.repositoryId), GITHUB_REF: "refs/heads/main", GITHUB_SHA: "a".repeat(40),
  GITHUB_RUN_ID: "123", RELEASE_CONFIRMATION: p.sha, GITHUB_TOKEN: "ephemeral-fixture" });
function source() {
  const repo = { id: p.repositoryId, full_name: p.repository };
  const names = ["scope", "checks", "backend", "build", "platform", "verify", "visual (1)", "visual (2)", "visual (3)", "visual (4)", "smoke (1)", "smoke (2)", "smoke (3)", "deploy"];
  return {
    run: { id: p.runId, run_attempt: 1, workflow_id: p.workflowId, path: ".github/workflows/ci.yml", repository: repo, head_repository: repo,
      event: "push", status: "completed", conclusion: "success", head_sha: p.sha, head_branch: "main" },
    jobs: { total_count: names.length, jobs: names.map(name => ({ name, run_id: p.runId, head_sha: p.sha, status: "completed", conclusion: name === "deploy" ? "skipped" : "success" })) },
    artifact: { id: p.artifactId, name: `release-${p.sha}`, expired: false, expires_at: "2026-11-03T07:05:38Z", size_in_bytes: p.size, digest: `sha256:${p.digest}`,
      workflow_run: { id: p.runId, repository_id: p.repositoryId, head_repository_id: p.repositoryId, head_branch: "main", head_sha: p.sha } },
  };
}
const now = Date.parse("2026-10-20T08:00:00Z");
it("accepts only the approved dispatch context and rejects input before using a token", async () => {
  expect(() => validateContext(env())).not.toThrow();
  for (const [key, value] of Object.entries({ GITHUB_EVENT_NAME: "pull_request", GITHUB_REPOSITORY: "fork/same-page", GITHUB_REPOSITORY_ID: "1", GITHUB_REF: "refs/heads/other", RELEASE_CONFIRMATION: `${p.sha}; touch /tmp/unsafe`, GITHUB_SHA: "main", GITHUB_RUN_ID: "x" })) {
    const fetchImpl = vi.fn();
    await expect(validateFromGitHub({ ...env(), [key]: value }, fetchImpl)).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  }
});
it("binds the successful attempt, full job set, repository and original artifact", () => {
  expect(() => validateSource(source(), now)).not.toThrow();
  for (const [key, value] of Object.entries({ id: 1, run_attempt: 2, workflow_id: 1, path: ".github/workflows/other.yml", event: "pull_request", status: "in_progress", conclusion: "failure", head_sha: "b".repeat(40), head_branch: "other", repository: {}, head_repository: {} })) {
    const data = source(); data.run[key] = value;
    expect(() => validateSource(data, now)).toThrow();
  }
  for (const [key, value] of Object.entries({ id: 1, name: "other", expired: true, expires_at: "invalid", size_in_bytes: 1, digest: `sha256:${"0".repeat(64)}`, workflow_run: {} })) {
    const data = source(); data.artifact[key] = value;
    expect(() => validateSource(data, now)).toThrow();
  }
  expect(() => validateSource(source(), Date.parse("2026-11-04"))).toThrow(/expired/);
});
it.each(["missing", "duplicate", "pagination", "skipped", "cancelled", "wrong-run", "wrong-sha"])("rejects %s CI evidence", kind => {
  const data = source();
  if (kind === "missing") { data.jobs.jobs.pop(); data.jobs.total_count--; }
  if (kind === "duplicate") data.jobs.jobs[0].name = "checks";
  if (kind === "pagination") data.jobs.total_count++;
  if (kind === "skipped" || kind === "cancelled") data.jobs.jobs[0].conclusion = kind;
  if (kind === "wrong-run") data.jobs.jobs[0].run_id++;
  if (kind === "wrong-sha") data.jobs.jobs[0].head_sha = "b".repeat(40);
  expect(() => validateSource(data, now)).toThrow();
});
it("fetches only fixed API endpoints, forbids redirects and propagates source API failures", async () => {
  const data = source();
  // Fix the clock only for the already approved artifact's expiry.
  const clock = vi.spyOn(Date, "now").mockReturnValue(now);
  try {
    const replies = [data.run, data.jobs, data.artifact];
    const fetchImpl = vi.fn(async () => Response.json(replies.shift()));
    await validateFromGitHub(env(), fetchImpl);
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      `https://api.github.com/repos/${p.repository}/actions/runs/${p.runId}/attempts/1`,
      `https://api.github.com/repos/${p.repository}/actions/runs/${p.runId}/attempts/1/jobs?per_page=100`,
      `https://api.github.com/repos/${p.repository}/actions/artifacts/${p.artifactId}`,
    ]);
    for (const [, init] of fetchImpl.mock.calls) expect(init).toMatchObject({ redirect: "error", headers: { authorization: "Bearer ephemeral-fixture" } });
    await expect(validateFromGitHub(env(), async () => new Response(null, { status: 403 }))).rejects.toThrow("HTTP 403");
  } finally { clock.mockRestore(); }
});
it("rejects changed ZIP bytes, including a same-size replacement", () => {
  const file = path.join(temp(), "source.zip");
  writeFileSync(file, "wrong ZIP"); expect(() => verifyArchive(file)).toThrow(/size/);
  writeFileSync(file, Buffer.alloc(p.size)); expect(() => verifyArchive(file)).toThrow(/digest/);
});
it("requires the approved runId as well as the exact per-file and build identities", async () => {
  const cwd = temp();
  for (const dir of ["dist/client/assets", "dist/same_page", "migrations"]) mkdirSync(path.join(cwd, dir), { recursive: true });
  for (const [file, body] of Object.entries({
    "dist/client/assets/app.js": "fixture", "dist/client/build.json": JSON.stringify({ buildId: p.sha, scripts: { "/assets/app.js": createHash("sha256").update("fixture").digest("hex") } }),
    "dist/client/index.html": `<meta name="same-page-build-id" content="${p.sha}">`, "dist/same_page/index.js": p.sha,
    "wrangler.jsonc": "{}", "package-lock.json": "{}", "migrations/0001.sql": "SELECT 1;",
  })) writeFileSync(path.join(cwd, file), body);
  await sealRelease({ cwd, sha: p.sha, runId: "wrong-run" });
  await expect(verifyExtractedRelease(cwd)).rejects.toThrow(/approved CI run/);
  await sealRelease({ cwd, sha: p.sha, runId: String(p.runId) });
  await expect(verifyExtractedRelease(cwd)).resolves.toMatchObject({ sha: p.sha });
  writeFileSync(path.join(cwd, "migrations/0001.sql"), "SELECT 2;");
  await expect(verifyExtractedRelease(cwd)).rejects.toThrow(/bytes/);
  // No release record/API call can be made for the wrong checkout or an invalid bundle.
  execFileSync("git", ["init", "-q"], { cwd });
  execFileSync("git", ["-c", "user.email=fixture@example.invalid", "-c", "user.name=fixture", "commit", "--allow-empty", "-qm", "fixture"], { cwd });
  const fetchImpl = vi.fn();
  await expect(admitControlledRelease({ cwd, env: env(), fetchImpl, output: path.join(cwd, "outputs") })).rejects.toThrow();
  expect(fetchImpl).not.toHaveBeenCalled();
});
it("safely extracts only release members and rejects paths, links, unexpected files and duplicate archives", () => {
  const root = temp();
  // Standard-library fixtures exercise the real Python extractor; no dependency install.
  execFileSync("python3", ["-c", `
import io, tarfile, zipfile, pathlib
root=pathlib.Path(${JSON.stringify(root)})
for case,name,kind in [('valid','dist/client/test.js','file'),('traversal','../escaped','file'),('absolute','/tmp/escaped','file'),('link','dist/link','link'),('unexpected','scripts/deploy.mjs','file')]:
    data=io.BytesIO()
    with tarfile.open(fileobj=data,mode='w') as tar:
        member=tarfile.TarInfo(name)
        if kind=='link': member.type=tarfile.SYMTYPE;member.linkname='/tmp/escaped';tar.addfile(member)
        else: member.size=2;tar.addfile(member,io.BytesIO(b'ok'))
    with zipfile.ZipFile(root/(case+'.zip'),'w') as zip: zip.writestr('release.tar',data.getvalue())
with zipfile.ZipFile(root/'duplicate.zip','w') as zip:
    zip.writestr('release.tar',b'a');zip.writestr('extra',b'b')
`]);
  const extract = name => execFileSync("python3", ["scripts/extract-controlled-release.py", path.join(root, `${name}.zip`), path.join(root, name)], { stdio: "pipe" });
  extract("valid"); expect(readFileSync(path.join(root, "valid/dist/client/test.js"), "utf8")).toBe("ok");
  for (const name of ["traversal", "absolute", "link", "unexpected", "duplicate"]) expect(() => extract(name)).toThrow();
});
it("keeps the extra read permission and cross-run token outside the production environment", () => {
  const workflow = readFileSync(".github/workflows/controlled-release.yml", "utf8");
  const [gate, production] = workflow.split("  production:\n");
  expect(gate).toContain("      actions: read"); expect(gate).not.toContain("secrets."); expect(gate).not.toContain("environment: production");
  expect(production).not.toContain("actions: read"); expect(production).not.toContain("github-token:");
  expect(production).toContain("group: same-page-production"); expect(production).toContain("environment: production");
  expect(production).toContain("permissions:\n      contents: read\n      deployments: write");
  expect(workflow).not.toMatch(/GITHUB_SHA:|pull_request:|push:/);
  expect(workflow).not.toMatch(/run:.*\$\{\{ inputs\./);
  expect(production.indexOf("id: admission")).toBeLessThan(production.indexOf("secrets.CLOUDFLARE_API_TOKEN"));
});
