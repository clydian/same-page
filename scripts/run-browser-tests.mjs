import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";

import { partitionSmokeTests, selectBrowserTests } from "./browser-test-selection.mjs";
import { changedBrowserPaths, planBrowserTests } from "./browser-test-plan.mjs";

const [suite, group = "all", shard = "1/1", base, ...extra] = process.argv.slice(2);
if (extra.length) throw new Error("Expected visual|smoke [all|library|gate|extended|related] [index/count] [base SHA]");
const directory = suite === "visual" ? "visual-report" : "browser-tests";
const entries = readdirSync(directory);
let selected;
if (group === "related" || (base !== undefined && ["gate", "library"].includes(group))) {
  selectBrowserTests({ suite, group: "all", shard, entries });
  const plan = planBrowserTests({ suite, entries, group: group === "library" ? "library" : "gate", changedFiles: changedBrowserPaths({ base }) });
  console.log(plan.reason);
  selected = group === "related" ? plan.related : plan.required;
  if (selected.length === 0) {
    console.log(`Browser suite ${suite}/${group}: no related tests selected.`);
    process.exit(0);
  }
  // Reuse the runner's strict shard validation for explicit planned files.
  selected = selectBrowserTests({ suite, group: "all", shard, entries: selected });
} else selected = selectBrowserTests({ suite, group, shard, entries });
const files = suite === "smoke" ? partitionSmokeTests(selected, shard) : selected;
const args = ["--test", "--test-reporter=tap"];
if (suite === "visual") args.push(`--test-shard=${shard}`);
if (suite === "visual") args.push("--test-global-setup=./visual-report/setup.mjs", "--test-concurrency=2");
else args.push("--test-concurrency=1"); // Stateful workerd fixtures must not compete for Vite dependency optimization.
console.log(`Browser suite ${suite}/${group} shard ${shard}, selected files: ${files.join(", ")}`);
const result = spawnSync(process.execPath, [...args, ...files.map(file => `${directory}/${file}`)], { stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
