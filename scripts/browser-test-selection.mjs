import assert from "node:assert/strict";

const library = {
  visual: ["drive-settings", "drive-navigation", "drive-library-lifecycle", "upload-queue", "responsive-navigation", "shared-layer-management"],
  smoke: ["storage-smoke", "offline-entry-smoke"],
};

// Select the scope and reject empty shards. Node's --test-shard owns partitioning.
export function selectBrowserTests({ suite, group = "all", shard = "1/1", entries }) {
  assert.ok(Object.hasOwn(library, suite), "Expected visual|smoke");
  assert.ok(["all", "library"].includes(group), "Expected all|library");
  assert.match(shard, /^[1-9]\d*\/[1-9]\d*$/, "Expected shard index/count");
  const [index, count] = shard.split("/").map(Number);
  assert.ok(Number.isSafeInteger(index) && Number.isSafeInteger(count) && index <= count, "Invalid shard range");
  const available = [...new Set(entries.filter(file => file.endsWith(".test.mjs")))].sort();
  const files = group === "all" ? available : library[suite].map(name => `${name}.test.mjs`).sort();
  assert.ok(files.length >= count, "Refusing empty browser test shards");
  assert.ok(files.every(file => available.includes(file)), "Selected browser test file is missing");
  return files;
}
