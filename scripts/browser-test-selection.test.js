import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { selectBrowserTests } from "./browser-test-selection.mjs";

// Fixture code stays constant: filenames and receipt paths are data, never
// JavaScript source (including when a future filename contains quotes).
const costFixture = `import test from 'node:test';
import { appendFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
const file = basename(fileURLToPath(import.meta.url));
test('fixture-' + file, () => appendFileSync(process.env.SAME_PAGE_SHARD_RECEIPTS, file + '\\n'));
`;

it("selects complete and audited library scopes, independent of directory order", () => {
  for (const [suite, directory] of [["visual", "visual-report"], ["smoke", "browser-tests"]]) {
    const entries = readdirSync(directory);
    for (const group of ["all", "library"]) {
      const count = suite === "smoke" && group === "library" ? 2 : 4;
      const files = selectBrowserTests({ suite, group, entries, shard: `1/${count}` });
      expect(files).toEqual(selectBrowserTests({ suite, group, entries: [...entries].reverse(), shard: `${count}/${count}` }));
      if (group === "all") expect(files).toEqual(entries.filter(file => file.endsWith(".test.mjs")).sort());
    }
  }
});

it("the real smoke runner partitions without omissions or duplicates, including new files", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "same-page-native-shards-"));
  const runner = fileURLToPath(new URL("./run-browser-tests.mjs", import.meta.url));
  const receipts = path.join(cwd, "receipts.txt");
  try {
    mkdirSync(path.join(cwd, "browser-tests"));
    const add = i => writeFileSync(path.join(cwd, "browser-tests", `${i}.test.mjs`), costFixture);
    for (let i = 0; i < 7; i++) add(i);
    for (const count of [2, 4]) {
      for (const total of [7, 8]) {
        if (total === 8) add(7);
        else rmSync(path.join(cwd, "browser-tests", "7.test.mjs"), { force: true });
        writeFileSync(receipts, "");
        const sizes = [];
        for (let i = 1; i <= count; i++) {
          const output = execFileSync(process.execPath, [runner, "smoke", "all", `${i}/${count}`], { cwd, encoding: "utf8", env: { ...process.env, SAME_PAGE_SHARD_RECEIPTS: receipts } });
          sizes.push((output.match(/# Subtest: fixture-/g) ?? []).length);
        }
        const seen = readFileSync(receipts, "utf8").trim().split("\n").map(file => Number(file.replace(".test.mjs", "")));
        expect(seen.sort((a, b) => a - b)).toEqual(Array.from({ length: total }, (_, i) => i));
        expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
      }
    }
  } finally { rmSync(cwd, { recursive: true, force: true }); }
}, 15_000); // Exercise both CI shard configurations through the actual runner.

it("rejects invalid requests, missing library files and empty shards", () => {
  const entries = readdirSync("browser-tests");
  const emptyShard = `1/${entries.filter(file => file.endsWith(".test.mjs")).length + 1}`;
  for (const shard of ["0/2", "3/2", "1/0", "1/2extra", "1/2/3", "1/99999999999999999", emptyShard]) {
    expect(() => selectBrowserTests({ suite: "smoke", entries, shard })).toThrow();
  }
  expect(() => selectBrowserTests({ suite: "unknown", entries })).toThrow();
  expect(() => selectBrowserTests({ suite: "smoke", group: "unknown", entries })).toThrow();
  expect(() => selectBrowserTests({ suite: "smoke", entries: [] })).toThrow();
  expect(() => selectBrowserTests({ suite: "smoke", group: "library", entries: ["storage-smoke.test.mjs"] })).toThrow();
});

it("the smoke runner keeps the recorded overloaded CI workload below the six-minute shard budget", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "same-page-ci-load-'quoted'-"));
  const runner = fileURLToPath(new URL("./run-browser-tests.mjs", import.meta.url));
  const receipts = path.join(cwd, "receipts.txt");
  const files = [...readdirSync("browser-tests").filter(file => file.endsWith(".test.mjs")), "quoted'filename.test.mjs"];
  // Conservative rounded file costs from run 40368368025's overloaded shard.
  // Other files cost zero here: this checks a measured lower-bound workload,
  // rather than echoing the scheduling algorithm or its complete cost model.
  const recorded = { "access-smoke": 25, "attachments-smoke": 35, "free-trial-smoke": 15,
    "musicxml-audio-startup": 35, "musicxml-playback": 70, "pdf-codecs-smoke": 40,
    "practice-compare": 55, "practice-rhythm": 45, "preview-notes-smoke": 65 };
  try {
    mkdirSync(path.join(cwd, "browser-tests"));
    for (const file of files) writeFileSync(path.join(cwd, "browser-tests", file), costFixture);
    const loads = [];
    const seen = [];
    for (let index = 1; index <= 4; index++) {
      writeFileSync(receipts, "");
      execFileSync(process.execPath, [runner, "smoke", "all", `${index}/4`], { cwd, stdio: "pipe", env: { ...process.env, SAME_PAGE_SHARD_RECEIPTS: receipts } });
      const selected = readFileSync(receipts, "utf8").trim().split("\n");
      seen.push(...selected);
      loads.push(selected.reduce((sum, file) => sum + (recorded[file.replace(".test.mjs", "")] ?? 0), 0));
    }
    expect(Math.max(...loads)).toBeLessThan(6 * 60);
    expect(seen.sort()).toEqual([...files].sort());
  } finally { rmSync(cwd, { recursive: true, force: true }); }
}, 20_000);
