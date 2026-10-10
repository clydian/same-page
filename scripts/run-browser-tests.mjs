import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";

import { planBrowserTests } from "./browser-test-plan.mjs";

const [suite, group = "all", shard = "1/1", ...extra] = process.argv.slice(2);
if (extra.length) throw new Error("Expected visual|smoke [all|library] [index/count]");
const directory = suite === "visual" ? "visual-report" : "browser-tests";
const files = planBrowserTests({ suite, group, shard, entries: readdirSync(directory) });
const args = ["--test", "--test-reporter=tap"];
if (suite === "visual") args.push("--test-global-setup=./visual-report/setup.mjs", "--test-concurrency=2");
else args.push("--test-concurrency=1"); // Stateful workerd fixtures must not compete for Vite dependency optimization.
console.log(`Browser suite ${suite}/${group} shard ${shard}: ${files.join(", ")}`);
const result = spawnSync(process.execPath, [...args, ...files.map(file => `${directory}/${file}`)], { stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
