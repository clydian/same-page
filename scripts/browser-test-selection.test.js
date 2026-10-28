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

it("partitions both browser suites without gaps; new tests default to the gate", () => {
  for (const [suite, dir] of [["visual", "visual-report"], ["smoke", "browser-tests"]]) {
    const entries = readdirSync(dir);
    const all = selectBrowserTests({ suite, entries });
    const gate = selectBrowserTests({ suite, group: "gate", entries });
    const extended = selectBrowserTests({ suite, group: "extended", entries });
    expect([...gate, ...extended].sort()).toEqual(all);
    expect(gate.some(file => extended.includes(file))).toBe(false);
    expect(selectBrowserTests({ suite, group: "gate", entries: [...entries, "new.test.mjs"] })).toContain("new.test.mjs");
    expect(() => selectBrowserTests({ suite, group: "gate", entries: entries.filter(x => x !== extended[0]) })).toThrow();
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
