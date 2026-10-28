import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { changedBrowserPaths, planBrowserTests } from "./browser-test-plan.mjs";
import { selectBrowserTests } from "./browser-test-selection.mjs";

const entries = readdirSync("visual-report");
const plan = (changedFiles, group = "gate", files = entries) => planBrowserTests({ suite: "visual", entries: files, changedFiles, group });
const directories = [];
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });

it("runs changed extended regressions without promoting them to the core", () => {
  const result = plan(["src/client/platform/use-input-visibility.ts", "visual-report/join-keyboard-extended.test.mjs"]);
  expect(result.related).toEqual(["join-keyboard-extended.test.mjs"]);
  expect(result.required).toContain("auth-keyboard.test.mjs");
  expect(result.required).not.toContain("join-keyboard-extended.test.mjs");
  expect(plan(["src/client/routes/home-page.tsx"]).related).toEqual([]);
  expect(plan(["docs/operations/ci.md"]).related).toEqual([]);
});

it("includes new and changed core tests outside a narrowed library scope", () => {
  const result = plan(["visual-report/new-core.test.mjs", "visual-report/auth-keyboard.test.mjs"], "library", [...entries, "new-core.test.mjs"]);
  expect(result.required).toEqual(expect.arrayContaining(["new-core.test.mjs", "auth-keyboard.test.mjs", "join-keyboard.test.mjs"]));
  expect(result.related).toEqual([]);
  expect(new Set(result.required).size).toBe(result.required.length);
});

it("broadens browser consumers for helpers, shared infrastructure or missing history", () => {
  const fullExtended = selectBrowserTests({ suite: "visual", group: "extended", entries });
  for (const changed of [["visual-report/join-keyboard-cases.mjs"], ["package-lock.json"], ["scripts/run-browser-tests.mjs"], null]) {
    expect(plan(changed, "library").related).toEqual(fullExtended);
    expect(plan(changed, "library").required).toEqual(selectBrowserTests({ suite: "visual", group: "gate", entries }));
  }
  const smokeEntries = readdirSync("browser-tests");
  for (const file of ["visual-report/fixtures.mjs", "visual-report/practice-fixture.mjs"]) {
    expect(planBrowserTests({ suite: "smoke", entries: smokeEntries, changedFiles: [file] }).related)
      .toEqual(selectBrowserTests({ suite: "smoke", group: "extended", entries: smokeEntries }));
  }
  expect(plan(["browser-tests/browser-evidence.mjs"]).related).toEqual(fullExtended);
  expect(plan(["visual-report/deleted.test.mjs"]).related).toEqual([]);
});

it("includes server helpers and binary fixtures in conservative suite widening", () => {
  const smokeEntries = readdirSync("browser-tests");
  const expected = selectBrowserTests({ suite: "smoke", group: "extended", entries: smokeEntries });
  for (const file of ["scripts/vite-server.mjs", "scripts/process-lifecycle.mjs", "scripts/new-shared-helper.mjs", "browser-tests/fixtures/image-codecs.pdf"]) {
    expect(planBrowserTests({ suite: "smoke", entries: smokeEntries, changedFiles: [file] }).related, file).toEqual(expected);
  }
  expect(plan(["scripts/vite-server.mjs"]).related.length).toBeGreaterThan(0);
});

function repository() {
  const cwd = mkdtempSync(path.join(tmpdir(), "same-page-browser-plan-")); directories.push(cwd);
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-q"); git("config", "user.name", "CI fixture"); git("config", "user.email", "fixture@example.invalid");
  const put = (name, text = "fixture\n") => { mkdirSync(path.dirname(path.join(cwd, name)), { recursive: true }); writeFileSync(path.join(cwd, name), text); };
  const commit = () => { git("add", "."); git("commit", "-qm", "fixture"); return git("rev-parse", "HEAD"); };
  return { cwd, git, put, commit };
}

it("uses the complete Git range and handles renames, deletions and unrelated main changes", () => {
  const repo = repository();
  repo.put("visual-report/old.test.mjs"); repo.put("visual-report/deleted.test.mjs"); const base = repo.commit();
  repo.git("checkout", "-qb", "topic");
  repo.git("mv", "visual-report/old.test.mjs", "visual-report/renamed.test.mjs");
  repo.git("rm", "visual-report/deleted.test.mjs"); repo.commit();
  repo.put("visual-report/new.test.mjs"); repo.commit();
  repo.git("checkout", "-qb", "base", base); repo.put("unrelated-main"); const newBase = repo.commit();
  repo.git("merge", "--no-ff", "-qm", "merge fixture", "topic");
  expect(changedBrowserPaths({ cwd: repo.cwd, base: newBase })).toEqual([
    "visual-report/deleted.test.mjs", "visual-report/new.test.mjs", "visual-report/old.test.mjs", "visual-report/renamed.test.mjs",
  ]);
  expect(changedBrowserPaths({ cwd: repo.cwd, base: "bad" })).toBeNull();
  expect(changedBrowserPaths({ cwd: repo.cwd, base: "f".repeat(40) })).toBeNull();
});

it("compares a push against its exact before commit even across divergent history", () => {
  const repo = repository();
  repo.put("visual-report/old.test.mjs", "old\n"); const base = repo.commit();
  repo.put("visual-report/old.test.mjs", "previous deployment\n"); const before = repo.commit();
  repo.git("checkout", "-qb", "replacement", base);
  repo.put("unrelated"); repo.commit();
  expect(changedBrowserPaths({ cwd: repo.cwd, base: before })).toEqual(["unrelated", "visual-report/old.test.mjs"]);
});

it("the real runner executes only related files across shards and propagates failure", () => {
  const repo = repository();
  const smokeEntries = readdirSync("browser-tests").filter(file => file.endsWith(".test.mjs"));
  const fixture = `import test from 'node:test'; import {appendFileSync} from 'node:fs';\ntest('fixture', () => appendFileSync(process.env.PLAN_RECEIPTS, import.meta.url + '\\n'));\n`;
  for (const file of smokeEntries) repo.put(`browser-tests/${file}`, fixture);
  for (const file of entries.filter(file => file.endsWith(".test.mjs"))) repo.put(`visual-report/${file}`, fixture);
  const base = repo.commit();
  const selected = ["practice-loop.test.mjs", "playback-ux.test.mjs"];
  for (const file of selected) repo.put(`browser-tests/${file}`, `${fixture}\n// changed\n`);
  repo.put("visual-report/join-keyboard-extended.test.mjs", `${fixture}\n// changed\n`);
  repo.commit();
  const output = path.join(repo.cwd, ".git", "plan-output");
  const summary = path.join(repo.cwd, ".git", "summary");
  execFileSync(process.execPath, [fileURLToPath(new URL("./browser-test-plan.mjs", import.meta.url)), base], {
    cwd: repo.cwd, env: { ...process.env, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary },
  });
  expect(readFileSync(output, "utf8")).toBe('visual=true\nvisual-count=1\nvisual-shards=[1]\nsmoke=true\nsmoke-count=2\nsmoke-shards=[1,2]\n');
  expect(readFileSync(summary, "utf8")).toContain("join-keyboard-extended.test.mjs");
  const receipts = path.join(repo.cwd, ".git", "receipts");
  const runner = fileURLToPath(new URL("./run-browser-tests.mjs", import.meta.url));
  const run = (shard, ref = base) => spawnSync(process.execPath, [runner, "smoke", "related", shard, ref], {
    cwd: repo.cwd, encoding: "utf8", env: { ...process.env, PLAN_RECEIPTS: receipts },
  });
  for (const shard of ["1/2", "2/2"]) { const result = run(shard); expect(result.status, result.stdout + result.stderr).toBe(0); }
  expect(readFileSync(receipts, "utf8").trim().split("\n").map(url => path.basename(url)).sort()).toEqual(selected.sort());
  const containerReceipts = path.join(repo.cwd, ".git", "container-receipts");
  const containerRun = spawnSync(process.execPath, [runner, "smoke", "related", "1/1", base], {
    cwd: repo.cwd, encoding: "utf8",
    env: { ...process.env, GIT_TEST_ASSUME_DIFFERENT_OWNER: "1", PLAN_RECEIPTS: containerReceipts },
  });
  expect(containerRun.status, containerRun.stdout + containerRun.stderr).toBe(0);
  expect(containerRun.stdout).not.toContain("Comparison unavailable");
  expect(readFileSync(containerReceipts, "utf8").trim().split("\n").map(url => path.basename(url)).sort()).toEqual(selected.sort());
  expect(run("0/2").status).not.toBe(0);
  repo.put("browser-tests/practice-loop.test.mjs", "import test from 'node:test'; test('failure', () => { throw Error('sentinel'); });\n"); repo.commit();
  expect(run("1/1").status).not.toBe(0);
  const empty = run("1/1", repo.git("rev-parse", "HEAD"));
  expect(empty.status).toBe(0); expect(empty.stdout).toContain("no related tests selected");
});
