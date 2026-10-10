import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { selectBrowserTests } from "./browser-test-selection.mjs";

it("selects complete and audited library scopes, independent of directory order", () => {
  for (const [suite, count, directory] of [["visual", 4, "visual-report"], ["smoke", 2, "browser-tests"]]) {
    const entries = readdirSync(directory);
    for (const group of ["all", "library"]) {
      const files = selectBrowserTests({ suite, group, entries, shard: `1/${count}` });
      expect(files).toEqual(selectBrowserTests({ suite, group, entries: [...entries].reverse(), shard: `${count}/${count}` }));
      if (group === "all") expect(files).toEqual(entries.filter(file => file.endsWith(".test.mjs")).sort());
      else expect(files.length).toBe(suite === "visual" ? 6 : 2);
    }
  }
});

it("the real runner uses native shards without omissions or duplicates, including new files", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "same-page-native-shards-"));
  const runner = fileURLToPath(new URL("./run-browser-tests.mjs", import.meta.url));
  const receipts = path.join(cwd, "receipts.txt");
  try {
    mkdirSync(path.join(cwd, "browser-tests"));
    const add = i => writeFileSync(path.join(cwd, "browser-tests", `${i}.test.mjs`), `import test from 'node:test'; import { appendFileSync } from 'node:fs'; test('fixture-${i}', () => appendFileSync(${JSON.stringify(receipts)}, '${i}\\n'));`);
    for (let i = 0; i < 7; i++) add(i);
    for (const total of [7, 8]) {
      if (total === 8) add(7);
      writeFileSync(receipts, "");
      const sizes = [];
      for (let i = 1; i <= 2; i++) {
        const output = execFileSync(process.execPath, [runner, "smoke", "all", `${i}/2`], { cwd, encoding: "utf8" });
        sizes.push((output.match(/# Subtest: fixture-/g) ?? []).length);
      }
      const seen = readFileSync(receipts, "utf8").trim().split("\n").map(Number);
      expect(seen.sort((a, b) => a - b)).toEqual(Array.from({ length: total }, (_, i) => i));
      expect(Math.abs(sizes[0] - sizes[1])).toBeLessThanOrEqual(1);
    }
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

it("rejects invalid requests, missing library files and empty shards", () => {
  const entries = readdirSync("browser-tests");
  for (const shard of ["0/2", "3/2", "1/0", "1/2extra", "1/2/3", "1/99999999999999999", "1/15"]) {
    expect(() => selectBrowserTests({ suite: "smoke", entries, shard })).toThrow();
  }
  expect(() => selectBrowserTests({ suite: "unknown", entries })).toThrow();
  expect(() => selectBrowserTests({ suite: "smoke", group: "unknown", entries })).toThrow();
  expect(() => selectBrowserTests({ suite: "smoke", entries: [] })).toThrow();
  expect(() => selectBrowserTests({ suite: "smoke", group: "library", entries: ["storage-smoke.test.mjs"] })).toThrow();
});
