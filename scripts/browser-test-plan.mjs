import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { selectBrowserTests } from "./browser-test-selection.mjs";

const sharedInfrastructure = new Set([
  "package.json", "package-lock.json", "vite.config.ts", "wrangler.jsonc",
  ".github/workflows/ci.yml", ".github/workflows/browser-extended.yml",
]);

// Unknown history must broaden verification rather than look like an empty PR.
export function changedBrowserPaths({ cwd = process.cwd(), base }) {
  try {
    if (!/^[a-f0-9]{40}$/.test(base ?? "")) return null;
    // Container checkout ownership can differ from the job user. Scope trust
    // to this read, so valid history does not silently become a full-suite run.
    return execFileSync("git", ["-c", `safe.directory=${cwd}`, "diff", "--name-only", "--no-renames", "-z", base, "HEAD", "--"],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).split("\0").filter(Boolean);
  } catch { return null; }
}

export function planBrowserTests({ suite, entries, changedFiles, group = "gate" }) {
  assert.ok(["gate", "library"].includes(group), "Expected a core test scope");
  const directory = suite === "visual" ? "visual-report" : "browser-tests";
  const allCore = selectBrowserTests({ suite, group: "gate", entries });
  const extended = selectBrowserTests({ suite, group: "extended", entries });
  const changed = new Set(changedFiles ?? []);
  const broad = changedFiles === null || [...changed].some(file => sharedInfrastructure.has(file) ||
    (file.startsWith("scripts/") && !/\.test\.[cm]?[jt]sx?$/.test(file)) ||
    // Fixtures cross the visual/smoke directories. Broaden both instead of
    // maintaining a source-to-consumer map that can silently drift.
    ((file.startsWith("visual-report/") || file.startsWith("browser-tests/")) && !file.endsWith(".test.mjs")));
  const changedTests = entries.filter(file => file.endsWith(".test.mjs") && changed.has(`${directory}/${file}`));
  const scopeCore = selectBrowserTests({ suite, group, entries });
  const required = [...new Set([...(broad ? allCore : scopeCore), ...changedTests.filter(file => allCore.includes(file))])].sort();
  const related = broad ? extended : extended.filter(file => changedTests.includes(file));
  return {
    required, related,
    reason: changedFiles === null ? "Comparison unavailable: run the complete suite, retaining core/advisory policy."
      : broad ? "Shared test infrastructure changed: broaden this suite."
        : "Core scope plus changed tests; changed extended tests remain advisory.",
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const changedFiles = changedBrowserPaths({ base: process.argv[2] });
  const plans = Object.fromEntries([["visual", "visual-report"], ["smoke", "browser-tests"]].map(([suite, directory]) =>
    [suite, planBrowserTests({ suite, entries: readdirSync(directory), changedFiles })]));
  for (const [suite, plan] of Object.entries(plans)) {
    console.log(`${suite}: ${JSON.stringify(plan)}`);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT,
      `${suite}=${plan.related.length > 0}\n${suite}-count=${Math.min(2, plan.related.length)}\n${suite}-shards=${JSON.stringify(Array.from({ length: Math.min(2, plan.related.length) }, (_, i) => i + 1))}\n`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `## PR browser test selection\n\n${Object.entries(plans).map(([suite, plan]) =>
      `### ${suite}\n\n${plan.reason}\n\nRequired: ${plan.required.join(", ")}\n\nRelated (advisory): ${plan.related.join(", ") || "none"}\n`).join("\n")}`);
}
