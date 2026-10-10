import { readdirSync } from "node:fs";
import { expect, it } from "vitest";
import { planBrowserTests } from "./browser-test-plan.mjs";

it("partitions every selected file exactly once for full and library CI matrices", () => {
  for (const [suite, count, directory] of [["visual", 4, "visual-report"], ["smoke", 2, "browser-tests"]]) {
    const entries = readdirSync(directory);
    for (const group of ["all", "library"]) {
      const selected = planBrowserTests({ suite, group, entries });
      const shards = Array.from({ length: count }, (_, i) => planBrowserTests({ suite, group, entries, shard: `${i + 1}/${count}` }));
      expect(shards.every(files => files.length > 0)).toBe(true);
      expect(shards.flat().sort()).toEqual(selected);
      expect(new Set(shards.flat()).size).toBe(selected.length);
    }
  }
});

it("includes new files automatically and assigns them consistently across runners", () => {
  const entries = [...readdirSync("visual-report"), "new-regression.test.mjs", "helper.mjs"];
  const first = Array.from({ length: 4 }, (_, i) => planBrowserTests({ suite: "visual", entries, shard: `${i + 1}/4` }));
  const reordered = Array.from({ length: 4 }, (_, i) => planBrowserTests({ suite: "visual", entries: [...entries].reverse(), shard: `${i + 1}/4` }));
  expect(first).toEqual(reordered);
  expect(first.flat().filter(file => file === "new-regression.test.mjs")).toHaveLength(1);
  expect(first.flat()).not.toContain("helper.mjs");
});

it("rejects invalid requests, missing library files and empty shards", () => {
  const entries = readdirSync("browser-tests");
  for (const shard of ["0/2", "3/2", "1/0", "1/2extra", "1/2/3", "1/99999999999999999", "1/15"]) {
    expect(() => planBrowserTests({ suite: "smoke", entries, shard })).toThrow();
  }
  expect(() => planBrowserTests({ suite: "unknown", entries })).toThrow();
  expect(() => planBrowserTests({ suite: "smoke", group: "unknown", entries })).toThrow();
  expect(() => planBrowserTests({ suite: "smoke", entries: [] })).toThrow();
  expect(() => planBrowserTests({ suite: "smoke", group: "library", entries: ["storage-smoke.test.mjs"] })).toThrow();
});
