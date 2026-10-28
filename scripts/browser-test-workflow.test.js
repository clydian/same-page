import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";

const workflow = readFileSync(new URL("../.github/workflows/browser-extended.yml", import.meta.url), "utf8");
const ci = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
const job = (text, name) => text.split(`\n  ${name}:\n`)[1].split(/\n  [a-z][\w-]*:\n/)[0];
const condition = text => text.match(/^    if: (.+)$/m)[1].replace(/^\$\{\{\s*|\s*\}\}$/g, "");

it("runs only selected advisory suites on PRs and keeps complete post-beta checks", () => {
  for (const suite of ["visual", "smoke"]) {
    const expression = condition(job(workflow, suite));
    const evaluate = (event, outputs) => runInNewContext(expression, { github: { event_name: event }, needs: { plan: { outputs } } });
    expect(evaluate("pull_request", { proceed: "true", [suite]: "true" })).toBe(true);
    expect(evaluate("pull_request", { proceed: "true", [suite]: "false" })).toBe(false);
    expect(evaluate("workflow_run", { proceed: "true" })).toBe(true);
    expect(evaluate("workflow_run", { proceed: "false" })).toBe(false);
  }
  const buildCondition = workflow.match(/- name: Build isolated candidate[^\n]*\n        if: (.+)/)[1];
  const build = (smoke, event = "pull_request") => runInNewContext(buildCondition, {
    github: { event_name: event }, steps: { related: { outputs: { smoke } } },
  });
  expect(build("true")).toBe(true);
  expect(build("false")).toBe(false);
  expect(build("true", "workflow_run")).toBe(false);
});

it("keeps PR failures and cancellation isolated from publication and production reporting", () => {
  const report = job(workflow, "report");
  const evaluate = event => runInNewContext(condition(report), {
    always: () => true, github: { event_name: event }, needs: { plan: { result: "success", outputs: { proceed: "true" } } },
  });
  expect(evaluate("pull_request")).toBe(false);
  expect(evaluate("workflow_run")).toBe(true);
  expect(workflow).not.toContain("continue-on-error");
  expect(workflow).not.toContain("pull_request_target");
  expect(workflow).toContain("cancel-in-progress: ${{ github.event_name == 'pull_request' }}");
  expect(job(ci, "verify")).not.toMatch(/related|extended/);
  expect(job(ci, "deploy")).not.toMatch(/needs:.*related|needs:.*extended/);
});

it("core selection no longer depends on deploying code and every runner gets comparison history", () => {
  for (const suite of ["visual", "smoke"]) {
    const core = job(ci, suite);
    expect(core).not.toContain("needs.scope.outputs.deploy");
    expect(core).toContain("fetch-depth: 0");
    expect(core).toContain('"$TEST_BASE"');
    expect(core).toContain("TEST_BASE: ${{ needs.scope.outputs.base }}");
    const advisory = job(workflow, suite);
    expect(advisory).toContain("fetch-depth: 0");
    expect(advisory).toContain("TEST_BASE: ${{ needs.plan.outputs.base }}");
  }
});
