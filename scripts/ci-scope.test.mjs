import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

import { determineCiScope } from "./ci-scope.mjs";

function repository(t) {
  const cwd = mkdtempSync(path.join(tmpdir(), "same-page-ci-scope-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  const put = (name, content = "test\n") => {
    mkdirSync(path.dirname(path.join(cwd, name)), { recursive: true });
    writeFileSync(path.join(cwd, name), content);
  };
  const commit = () => {
    git("add", ".");
    git("commit", "-qm", "fixture");
    return git("rev-parse", "HEAD");
  };
  git("init", "-q");
  git("config", "user.email", "ci@example.invalid");
  git("config", "user.name", "CI test");
  put("README.md");
  put("src/app.ts");
  const base = commit();
  const scope = (eventName = "pull_request", event = { pull_request: { base: { sha: base } } }) =>
    determineCiScope({ cwd, eventName, event });
  return { cwd, put, git, commit, base, scope };
}

test("Markdown-only PRs use the lightweight path", (t) => {
  const repo = repository(t);
  repo.put("docs/with spaces/说明.md");
  repo.put("README.md", "updated\n");
  repo.commit();
  assert.equal(repo.scope().full, false);
});

test("code, config, dependencies, workflow and unknown files require full verification", (t) => {
  const repo = repository(t);
  for (const name of ["src/app.ts", "package-lock.json", ".github/workflows/ci.yml", "docs/example.js", "new.file"]) {
    repo.git("reset", "--hard", repo.base);
    repo.put(name, "updated\n");
    repo.commit();
    assert.equal(repo.scope().full, true, name);
  }
});

test("runtime areas select only their relevant expensive checks", (t) => {
  const repo = repository(t);
  const expectedByPath = new Map([
    ["scripts/browser-test-selection.mjs", ["client", "visual", "build", "smoke"]],
    ["src/client/routes/home-page.tsx", ["client", "visual", "performance", "build", "smoke", "deploy"]],
    ["src/client/pwa-navigation.ts", ["client", "visual", "pwa", "performance", "build", "smoke", "deploy"]],
    ["src/client/updates/update-controller.ts", ["client", "visual", "pwa", "performance", "build", "smoke", "deploy"]],
    ["worker/index.ts", ["worker", "build", "smoke", "deploy"]],
    ["src/shared/health.ts", ["client", "worker", "visual", "performance", "build", "smoke", "deploy"]],
    ["migrations/0002.sql", ["worker", "migration", "build", "smoke", "deploy"]],
    ["visual-report/layout.test.mjs", ["visual"]],
    ["browser-tests/browser-evidence.mjs", ["visual", "build", "smoke"]],
    ["browser-tests/sanitize-browser-trace.py", ["visual", "build", "smoke"]],
    ["scripts/run-browser-tests.mjs", ["visual", "build", "smoke"]],
    ["scripts/verify-score-schema-migration.mjs", ["migration"]],
  ]);

  for (const [name, enabled] of expectedByPath) {
    repo.git("reset", "--hard", repo.base);
    repo.put(name, "updated\n");
    repo.commit();
    const scope = repo.scope();
    assert.equal(scope.full, true, name);
    for (const check of ["client", "worker", "visual", "pwa", "performance", "migration", "build", "deploy", "smoke"]) {
      assert.equal(scope[check], enabled.includes(check), `${name}: ${check}`);
    }
  }
});

test("test and CI changes run checks without deploying product code", (t) => {
  const repo = repository(t);
  for (const [name, enabled] of [
    ["src/client/app.test.tsx", ["client"]],
    ["src/shared/annotations.test.ts", ["client"]],
    ["src/test/setup.ts", ["client"]],
    ["worker/index.test.ts", ["worker"]],
    [".github/workflows/ci.yml", ["client", "worker", "visual", "pwa", "performance", "migration", "build"]],
  ]) {
    repo.git("reset", "--hard", repo.base);
    repo.put(name, "updated\n");
    repo.commit();
    const scope = repo.scope();
    assert.equal(scope.full, true, name);
    assert.equal(scope.deploy, false, name);
    for (const check of enabled) assert.equal(scope[check], true, `${name}: ${check}`);
  }
});

test("push scope includes every commit since before, not just the last commit", (t) => {
  const repo = repository(t);
  repo.put("src/app.ts", "changed\n");
  repo.commit();
  repo.put("README.md", "updated\n");
  repo.commit();
  assert.equal(repo.scope("push", { before: repo.base }).full, true);
});

test("renaming code to Markdown cannot bypass full verification", (t) => {
  const repo = repository(t);
  renameSync(path.join(repo.cwd, "src/app.ts"), path.join(repo.cwd, "CONTEXT.md"));
  repo.commit();
  assert.equal(repo.scope().full, true);
});

test("deleted code cannot bypass full verification", (t) => {
  const repo = repository(t);
  rmSync(path.join(repo.cwd, "src/app.ts"));
  repo.commit();
  assert.equal(repo.scope().full, true);
});

test("all files are examined beyond GitHub's 300-file workflow filter limit", (t) => {
  const repo = repository(t);
  for (let i = 0; i < 350; i++) repo.put(`docs/${i}.md`);
  repo.put("src/app.ts", "changed\n");
  repo.commit();
  assert.equal(repo.scope().full, true);
});

test("missing history, empty changes, new branches and unknown events fail closed", (t) => {
  const repo = repository(t);
  assert.equal(repo.scope().full, true);
  assert.equal(repo.scope("push", { before: "0".repeat(40) }).full, true);
  assert.equal(repo.scope("push", { before: "f".repeat(40) }).full, true);
  assert.equal(repo.scope("pull_request", {}).full, true);
  assert.equal(repo.scope("pull_request", null).full, true);
  assert.equal(repo.scope("workflow_dispatch", {}).full, true);
});

test("Markdown-only main pushes can skip deployment", (t) => {
  const repo = repository(t);
  repo.put("docs/operations/ci.md");
  repo.commit();
  assert.equal(repo.scope("push", { before: repo.base }).full, false);
});

test("a PR merge compares against the updated base, excluding unrelated main changes", (t) => {
  const repo = repository(t);
  repo.git("checkout", "-qb", "topic");
  repo.put("docs/change.md");
  repo.commit();
  repo.git("checkout", "-qb", "base", repo.base);
  repo.put("src/app.ts", "unrelated main change\n");
  const updatedBase = repo.commit();
  repo.git("merge", "--no-ff", "-qm", "synthetic PR merge", "topic");
  assert.equal(repo.scope("pull_request", { pull_request: { base: { sha: updatedBase } } }).full, false);
});

test("the workflow entrypoint emits scope and rejects whitespace errors in docs", (t) => {
  const repo = repository(t);
  const output = path.join(repo.cwd, ".git", "output");
  const eventPath = path.join(repo.cwd, ".git", "event.json");
  writeFileSync(eventPath, JSON.stringify({ before: repo.base }));
  const run = () => spawnSync(process.execPath, [fileURLToPath(new URL("./ci-scope.mjs", import.meta.url))], {
    cwd: repo.cwd,
    env: { ...process.env, GITHUB_EVENT_NAME: "push", GITHUB_EVENT_PATH: eventPath, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: "" },
    encoding: "utf8",
  });
  repo.put("docs/change.md");
  repo.commit();
  assert.equal(run().status, 0);
  assert.equal(
    readFileSync(output, "utf8"),
    "full=false\nclient=false\nworker=false\nvisual=false\npwa=false\nperformance=false\nmigration=false\nbuild=false\ndeploy=false\nsmoke=false\nbrowserGroup=all\n",
  );
  rmSync(output);
  repo.put("docs/change.md", "bad whitespace \t\n");
  repo.commit();
  const result = run();
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /trailing whitespace/);
});

test("shared test infrastructure selects its actual browser, PWA, performance and artifact consumers without deployment", (t) => {
  const repo = repository(t);
  for (const name of ["scripts/vite-server.mjs", "scripts/process-lifecycle.mjs", "scripts/deployment-identity.mjs", "scripts/release-artifact.mjs", "scripts/new-shared-helper.mjs"]) {
    repo.git("reset", "--hard", repo.base);
    repo.put(name); repo.commit();
    const scope = repo.scope();
    for (const check of ["client", "visual", "pwa", "performance", "build", "smoke"]) assert.equal(scope[check], true, `${name}: ${check}`);
    assert.equal(scope.deploy, false, name);
  }
});

test("documentation mixed with verification changes does not trigger deployment", (t) => {
  const repo = repository(t);
  repo.put("README.md", "docs updated"); repo.put("scripts/release-admission.mjs"); repo.commit();
  assert.equal(repo.scope().deploy, false);
});

// These real review artifacts previously made unrelated reader PRs run PWA,
// migrations and packaging. Executable or unknown docs still fail closed.
test("review evidence does not widen a reader PR or deploy an evidence-only push", (t) => {
  const repo = repository(t);
  repo.put("docs/operations/issue-142/390-menu.png");
  repo.put("docs/operations/issue-142/evidence.json", "{}\n");
  repo.commit();
  assert.equal(repo.scope("push", { before: repo.base }).full, false);
  repo.put("src/client/reader/reader-ux.css");
  repo.commit();
  const scope = repo.scope();
  for (const check of ["client", "visual", "build", "smoke"]) assert.equal(scope[check], true, check);
  for (const check of ["worker", "pwa", "migration"]) assert.equal(scope[check], false, check);
});



test("audited library leaves select entry/storage consumers; mixed shared changes widen to all", t => {
  const repo = repository(t);
  repo.put("src/client/score-library/drive-settings-dialog.tsx"); repo.commit();
  assert.equal(repo.scope().browserGroup, "library");
  assert.equal(repo.scope().performance, false);
  for (const key of ["client", "visual", "smoke", "build", "deploy"]) assert.equal(repo.scope()[key], true);
  for (const file of ["src/client/reader/reader-session.ts", "src/client/auth/application-identity.tsx", "src/client/offline/offline-score.ts", "src/client/styles.css", "new-path", "package-lock.json"]) {
    repo.put(file); repo.commit();
    assert.equal(repo.scope().browserGroup, "all", file);
    assert.equal(repo.scope().smoke, true, file);
  }
  assert.equal(repo.scope("push", {}).browserGroup, "all");
});

test("changes to the selector itself receive full verification", t => {
  const repo = repository(t);
  repo.put("scripts/ci-scope.mjs"); repo.commit();
  for (const key of ["client", "worker", "visual", "smoke", "pwa", "migration", "performance", "build"]) assert.equal(repo.scope()[key], true, key);
});

test("the workflow gate rejects failure, cancellation and unexpected skips of selected jobs", () => {
  const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  const script = workflow.match(/node --input-type=module <<'JS'\n([\s\S]*?)\n\s*JS/)[1];
  // Execute the actual gate body in-process; dozens of Node startups would
  // make this safety check itself an avoidable CI cost.
  const gate = new Function("assert", "process", script.replace(/import assert from 'node:assert\/strict';/, ""));
  const run = jobs => {
    try { gate(assert, { env: { RESULTS: JSON.stringify(jobs) } }); return 0; }
    catch { return 1; }
  };
  for (const outputs of [
    { full: "false" },
    { full: "true", client: "true" },
    { full: "true", worker: "true" },
    { full: "true", migration: "true" },
    { full: "true", migration: "true", worker: "true" },
    { full: "true", build: "true" },
    { full: "true", performance: "true", build: "true" },
    { full: "true", pwa: "true" },
    { full: "true", smoke: "true", build: "true" },
    { full: "true", visual: "true", smoke: "true", build: "true", browserGroup: "library" },
    { full: "true", visual: "true", pwa: "true", browserGroup: "all" },
  ]) {
    const jobs = {
      scope: { result: "success", outputs },
      checks: { result: outputs.full === "true" ? "success" : "skipped" },
      backend: { result: ["worker", "migration"].some(key => outputs[key] === "true") ? "success" : "skipped" },
      visual: { result: outputs.visual === "true" ? "success" : "skipped" },
      build: { result: ["build", "smoke"].some(key => outputs[key] === "true") ? "success" : "skipped" },
      platform: { result: ["pwa", "performance"].some(key => outputs[key] === "true") ? "success" : "skipped" },
      smoke: { result: outputs.smoke === "true" ? "success" : "skipped" },
    };
    assert.equal(run(jobs), 0);
    for (const [name, job] of Object.entries(jobs)) {
      for (const result of ["failure", "cancelled", job.result === "success" ? "skipped" : "success"]) {
        assert.notEqual(run({ ...jobs, [name]: { ...job, result } }), 0, `${name}/${result}`);
      }
    }
  }
});

test("deployment follows the successful verification gate even when an ancestor is skipped", () => {
  const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  const condition = workflow.match(/\n  deploy:\n(?:    #.*\n)*    if: (.+)/)[1]
    .replace(/^\$\{\{\s*|\s*\}\}$/g, "");
  // GitHub implicitly prefixes success() unless the job condition includes a
  // status function. A legitimately skipped backend made this false in #415.
  const expression = /\b(?:always|cancelled|failure|success)\s*\(/.test(condition)
    ? condition : `success() && (${condition})`;
  const evaluate = (overrides = {}) => runInNewContext(expression, {
    success: () => false,
    cancelled: () => false,
    github: { event_name: "push", ref: "refs/heads/main" },
    needs: { verify: { result: "success", outputs: { deploy: "true" } } },
    ...overrides,
  });
  assert.equal(evaluate(), true, "a skipped unselected ancestor must not suppress a verified release");
  assert.equal(evaluate({ cancelled: () => true }), false);
  for (const result of ["failure", "cancelled", "skipped"]) {
    assert.equal(evaluate({ needs: { verify: { result, outputs: { deploy: "true" } } } }), false, result);
  }
  assert.equal(evaluate({ needs: { verify: { result: "success", outputs: { deploy: "false" } } } }), false);
  for (const github of [
    { event_name: "pull_request", ref: "refs/heads/main" },
    { event_name: "push", ref: "refs/heads/other" },
  ]) assert.equal(evaluate({ github }), false);
});

test("container deployment trusts only its workspace before real Git release admission", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "same-page-container git-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cwd = path.join(root, "workspace with spaces");
  const checkoutHome = path.join(root, "checkout-home");
  const jobHome = path.join(root, "job-home");
  const sibling = path.join(root, "another-repository");
  for (const directory of [cwd, checkoutHome, jobHome, sibling]) mkdirSync(directory);
  const environment = (home) => ({ PATH: process.env.PATH, HOME: home, GIT_CONFIG_NOSYSTEM: "1" });
  const git = (...args) => execFileSync("git", args, { cwd, env: environment(checkoutHome), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-q");
  git("config", "user.email", "release@example.invalid");
  git("config", "user.name", "CI fixture");
  const commit = (content) => {
    writeFileSync(path.join(cwd, "product"), content);
    git("add", ".");
    git("commit", "-qm", "fixture");
    return git("rev-parse", "HEAD");
  };
  const base = commit("base");
  const old = commit("old");
  const current = commit("current");
  git("checkout", "--detach", base);
  const divergent = commit("divergent");
  git("checkout", "--detach", current);
  execFileSync("git", ["init", "-q", sibling], { env: environment(checkoutHome) });

  // actions/checkout trusts the mount only in its temporary HOME. Later run
  // steps use the job HOME and encounter the container's different owner.
  git("config", "--global", "--add", "safe.directory", cwd);
  const env = { ...environment(jobHome), GIT_TEST_ASSUME_DIFFERENT_OWNER: "1", GITHUB_WORKSPACE: cwd };
  const rawGit = (directory = cwd, overrides = {}) => spawnSync("git", ["rev-parse", "HEAD"], { cwd: directory, env: { ...env, ...overrides }, encoding: "utf8" });
  assert.equal(rawGit(cwd, { HOME: checkoutHome }).status, 0);
  assert.match(rawGit().stderr, /detected dubious ownership/);

  const callsFile = path.join(root, "github-calls.jsonl");
  const hook = path.join(root, "github-fixture.mjs");
  writeFileSync(hook, `
    import assert from "node:assert/strict";
    import { appendFileSync } from "node:fs";
    globalThis.fetch = async (url, init = {}) => {
      const target = new URL(url);
      assert.equal(target.origin, "https://api.github.com");
      assert.match(target.pathname, /^\\/repos\\/fixture\\/repo\\/deployments(?:\\/42\\/statuses)?$/);
      const body = init.body ? JSON.parse(init.body) : undefined;
      appendFileSync(process.env.CALLS_FILE, JSON.stringify({ method: init.method, body }) + "\\n");
      if (init.method === "GET") return Response.json([{ sha: process.env.PREVIOUS_SHA }]);
      assert.equal(init.method, "POST");
      if (target.pathname.endsWith("/statuses")) assert.equal(body.state, "in_progress");
      else assert.equal(body.ref, process.env.GITHUB_SHA);
      return Response.json({ id: 42 });
    };
  `);
  const admission = fileURLToPath(new URL("./release-admission.mjs", import.meta.url));
  const admit = (sha = current, previous = base) => {
    const output = path.join(root, "github-output");
    writeFileSync(output, "");
    writeFileSync(callsFile, "");
    const result = spawnSync(process.execPath, ["--import", hook, admission, "admit"], {
      cwd, encoding: "utf8", env: {
        ...env, GITHUB_SHA: sha, PREVIOUS_SHA: previous, GITHUB_RUN_ID: "42",
        GITHUB_REPOSITORY: "fixture/repo", GITHUB_TOKEN: "fixture", GITHUB_OUTPUT: output, CALLS_FILE: callsFile,
      },
    });
    return { ...result, output: readFileSync(output, "utf8"), calls: readFileSync(callsFile, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) };
  };
  assert.match(admit().stderr, /detected dubious ownership/);

  // Execute the workflow's actual bootstrap commands in separate shells, as
  // Actions does. A YAML-only assertion would miss Git's protected config scope.
  const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  const beforeAdmission = workflow.split("\n  deploy:\n")[1].split("      - name: Admit release under production lock\n")[0];
  for (const [, command] of beforeAdmission.matchAll(/^ {8}run: (.+)$/gm)) {
    execFileSync("sh", ["-e", "-c", command], { cwd, env });
  }
  const accepted = admit();
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.equal(accepted.output, "proceed=true\ndeployment_id=42\n");
  assert.deepEqual(accepted.calls.map(call => call.method), ["GET", "POST", "POST"]);
  const trusted = execFileSync("git", ["config", "--global", "--get-all", "safe.directory"], { cwd, env, encoding: "utf8" });
  assert.equal(trusted, `${cwd}\n`);
  assert.match(rawGit(sibling).stderr, /detected dubious ownership/);

  const wrongSha = admit(base);
  assert.notEqual(wrongSha.status, 0);
  assert.match(wrongSha.stderr, /AssertionError/);
  assert.deepEqual(wrongSha.calls, []);
  git("checkout", "--detach", old);
  const skipped = admit(old, current);
  assert.equal(skipped.status, 0, skipped.stderr);
  assert.equal(skipped.output, "proceed=false\ndeployment_id=\n");
  assert.deepEqual(skipped.calls.map(call => call.method), ["GET"]);
  git("checkout", "--detach", divergent);
  const rejected = admit(divergent, current);
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /divergent release history/);
  assert.deepEqual(rejected.calls.map(call => call.method), ["GET"]);

  git("checkout", "--detach", current);
  execFileSync("git", ["config", "--global", "--unset-all", "safe.directory"], { cwd, env });
  const untrustedAgain = admit();
  assert.match(untrustedAgain.stderr, /detected dubious ownership/);
  assert.deepEqual(untrustedAgain.calls, []);
});

test("retired consumer deployment fix builds and deploys on main", t => {
  const repo = repository(t);
  repo.put("scripts/retire-image-consumer.mjs"); repo.commit();
  const scope = repo.scope("push", { before: repo.base });
  for (const key of ["client", "build", "smoke", "deploy"]) assert.equal(scope[key], true, key);
});

test("consumer retirement runs under release admission after artifact validation and before schema removal and publish", () => {
  const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  const names = ["Admit release under production lock", "Verify artifact before production writes", "Detach retired image queue consumer", "Apply production database migrations", "Deploy Worker and assets"];
  const positions = names.map(name => workflow.indexOf(`- name: ${name}`));
  assert(positions.every((value, i) => value >= 0 && (i === 0 || value > positions[i - 1])));
  const step = workflow.slice(positions[2], positions[3]);
  assert.match(step, /if: steps.admission.outputs.proceed == 'true'/);
  assert.match(step, /run: node scripts\/retire-image-consumer.mjs/);
  assert.doesNotMatch(step, /continue-on-error|\|\| true/);
});


test("local player source selects product, offline and deployment verification", t => {
  const repo = repository(t);
  repo.put("packages/player/src/session.ts"); repo.commit();
  const scope = repo.scope("push", { before: repo.base });
  for (const key of ["client", "worker", "visual", "pwa", "performance", "build", "smoke", "deploy"]) assert.equal(scope[key], true, key);
});
