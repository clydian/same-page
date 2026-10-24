import { afterEach, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "./samepage.mjs";

const score = "11111111-1111-4111-8111-111111111111";
const version = "22222222-2222-4222-8222-222222222222";
const candidate = "33333333-3333-4333-8333-333333333333";
const token = `sp_cli_${"a".repeat(64)}`;
const env = { SAME_PAGE_TOKEN: token, SAME_PAGE_URL: "https://same-page.test" };
const cleanup = [];
afterEach(async () => { await Promise.all(cleanup.splice(0).map((f) => f())); });
const jsonResponse = (data, status = 200) => Response.json(data, { status });
const digest = (data) => createHash("sha256").update(data).digest("hex");
async function directory() {
  const path = await mkdtemp(join(tmpdir(), "samepage-cli-"));
  cleanup.push(() => rm(path, { recursive: true, force: true }));
  return path;
}
function capture(fetch) {
  const output = [], warnings = [], requests = [];
  return {
    output, warnings, requests,
    options: { env, write: (v) => output.push(v), warn: (v) => warnings.push(v), fetch: async (url, init) => {
      requests.push({ url, init });
      return fetch(url, init);
    } },
  };
}

it("reads every score page with one scoped bearer and JSON-only stdout", async () => {
  const c = capture((url) => new URL(url).searchParams.has("after")
    ? jsonResponse({ scores: [{ id: "second" }], next: null })
    : jsonResponse({ scores: [{ id: score }], next: score }));
  await runCli(["scores", "--drive", version, "--query", "甲 谱", "--json"], c.options);
  expect(JSON.parse(c.output[0])).toEqual({ scores: [{ id: score }, { id: "second" }] });
  expect(c.requests).toHaveLength(2);
  for (const { url, init } of c.requests) {
    expect(new URL(url).searchParams.get("drive")).toBe(version);
    expect(new URL(url).searchParams.get("q")).toBe("甲 谱");
    expect(init.headers.Authorization).toBe(`Bearer ${token}`);
    expect(init.redirect).toBe("error");
    expect(init.headers.Cookie).toBeUndefined();
  }
  expect(c.output.join("\n")).not.toContain(token);
});

it("accepts existing opaque drive and score IDs instead of assuming every ID is a UUID", async () => {
  const c = capture(() => jsonResponse({ scores: [], next: null }));
  await runCli(["scores", "--drive", "legacy-drive", "--json"], c.options);
  expect(new URL(c.requests[0].url).searchParams.get("drive")).toBe("legacy-drive");
  await runCli(["status", "legacy-score", "--json"], c.options);
  expect(new URL(c.requests[1].url).pathname).toBe("/api/admin/scores/legacy-score");
});

it("never saves mismatched PDF bytes and refuses a changed expected source version", async () => {
  const out = join(await directory(), "source.pdf");
  const c = capture((url) => url.includes("/pdf?") ? new Response("bad bytes")
    : jsonResponse({ score: { versionId: version, sha256: digest("correct") } }));
  await expect(runCli(["download-pdf", score, "--out", out], c.options)).rejects.toThrow("SHA-256");
  await expect(readFile(out)).rejects.toMatchObject({ code: "ENOENT" });
  c.requests.length = 0;
  await expect(runCli(["download-pdf", score, "--out", out, "--version", candidate], c.options)).rejects.toThrow("版本已变化");
  expect(c.requests).toHaveLength(1);
});

it("pins PDF downloads to the inspected version and preserves an existing destination", async () => {
  const out = join(await directory(), "source.pdf"), bytes = Buffer.from("%PDF-fixture");
  const c = capture((url) => url.includes("/pdf?") ? new Response(bytes)
    : jsonResponse({ score: { versionId: version, sha256: digest(bytes) } }));
  await runCli(["download-pdf", score, "--out", out, "--json"], c.options);
  expect(await readFile(out)).toEqual(bytes);
  expect(c.requests[1].url).toContain(`versionId=${version}`);
  expect(JSON.parse(c.output[0])).toMatchObject({ sourceVersionId: version, sha256: digest(bytes) });
  await expect(runCli(["download-pdf", score, "--out", out], c.options)).rejects.toMatchObject({ code: "EEXIST" });
  expect(await readFile(out)).toEqual(bytes);
});

it("uploads exact bytes with the supplied retry identity and immutable source", async () => {
  const file = join(await directory(), "练习.musicxml"), bytes = Buffer.from("<score-partwise/>");
  await writeFile(file, bytes);
  const c = capture(() => jsonResponse({ id: candidate }));
  await runCli(["upload", score, file, "--source-version", version, "--id", candidate, "--json"], c.options);
  const { url, init } = c.requests[0], query = new URL(url).searchParams;
  expect(new URL(url).pathname).toBe(`/api/admin/scores/${score}/candidates/${candidate}`);
  expect(query.get("sourceVersionId")).toBe(version);
  expect(query.get("sha256")).toBe(digest(bytes));
  expect(query.get("size")).toBe(String(bytes.length));
  expect(query.get("name")).toBe("练习.musicxml");
  expect(init.method).toBe("POST");
  expect(init.body).toEqual(bytes);
  expect(JSON.parse(c.output[0])).toMatchObject({ id: candidate, sourceVersionId: version });
});

it("reports the candidate ID on ambiguous upload failure without retrying or leaking the token", async () => {
  const file = join(await directory(), "result.xml");
  await writeFile(file, "<score-partwise/>");
  const c = capture(() => { throw new Error(`sensitive ${token}`); });
  await expect(runCli(["upload", score, file, "--source-version", version, "--id", candidate], c.options)).rejects.toThrow("同一个 --id");
  expect(c.requests).toHaveLength(1);
  expect(c.warnings.join("\n")).toContain(`--id ${candidate}`);
  expect(c.warnings.join("\n")).not.toContain(token);
});

it("uses selected older candidates and the current published revision for XML downloads", async () => {
  const dir = await directory(), bytes = Buffer.from("<score-partwise/>");
  const detail = { score: { attachmentId: score, attachmentRevision: 2, publishedSource: version }, candidates: [],
    selectedCandidate: { id: candidate, state: "ready", sha256: digest(bytes), sourceVersionId: version } };
  const c = capture((url) => url.includes("/file") || url.includes("/published?") ? new Response(bytes) : jsonResponse(detail));
  await runCli(["download-xml", score, "--candidate", candidate, "--out", join(dir, "candidate.xml")], c.options);
  expect(c.requests[0].url).toContain(`selected=${candidate}`);
  expect(c.requests[1].url).toContain(`/candidates/${candidate}/file`);
  await runCli(["download-xml", score, "--out", join(dir, "published.xml")], c.options);
  expect(c.requests[3].url).toContain("/published?revision=2");
});

it("does not follow redirects carrying the bearer token", async () => {
  let targetCalls = 0;
  const target = createServer((req, res) => { targetCalls++; res.end("unexpected"); });
  const source = createServer((req, res) => {
    res.writeHead(302, { location: `http://127.0.0.1:${target.address().port}/stolen` }); res.end();
  });
  await new Promise((resolve) => target.listen(0, "127.0.0.1", resolve));
  await new Promise((resolve) => source.listen(0, "127.0.0.1", resolve));
  cleanup.push(() => new Promise((resolve) => source.close(resolve)), () => new Promise((resolve) => target.close(resolve)));
  await expect(runCli(["drives"], { env: { ...env, SAME_PAGE_URL: `http://127.0.0.1:${source.address().port}` } })).rejects.toThrow("请求失败");
  expect(targetCalls).toBe(0);
});

it("rejects insecure origins and leaves server bodies out of errors", async () => {
  const c = capture(() => jsonResponse({ error: "forbidden", detail: token }, 403));
  await expect(runCli(["drives"], { ...c.options, env: { ...env, SAME_PAGE_URL: "http://example.com" } })).rejects.toThrow("HTTPS");
  expect(c.requests).toHaveLength(0);
  await expect(runCli(["drives"], c.options)).rejects.toThrow("HTTP 403: forbidden");
  expect(c.output).toHaveLength(0);
  expect(c.warnings).toHaveLength(0);
});

it("runs help without credentials and returns a nonzero process exit on missing credentials", () => {
  const options = { encoding: "utf8", env: { ...process.env, SAME_PAGE_TOKEN: "" } };
  const help = spawnSync(process.execPath, ["scripts/samepage.mjs", "--help"], options);
  expect(help.status).toBe(0);
  expect(help.stdout).toContain("download-pdf");
  const failure = spawnSync(process.execPath, ["scripts/samepage.mjs", "drives"], options);
  expect(failure.status).toBe(1);
  expect(failure.stderr).toContain("SAME_PAGE_TOKEN");
});
