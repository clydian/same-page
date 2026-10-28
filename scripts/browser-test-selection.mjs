import assert from "node:assert/strict";

const library = {
  visual: ["drive-entry", "drive-settings", "drive-navigation", "drive-navigation-settings", "drive-library-lifecycle", "join-keyboard", "upload-queue", "responsive-navigation", "shared-layer-management"],
  smoke: ["storage-smoke", "offline-entry-smoke"],
};
// Extended matrices are advisory for beta; changed ones also run on PRs.
// New files default to the blocking gate until deliberately classified here.
const extended = {
  visual: ["continuous-reader-layout", "diagnostics", "drive-context-attachments", "drive-navigation-settings", "drive-navigation", "drive-settings", "experience-continuity", "highlighter-nib", "invite-feedback", "join-keyboard-extended", "layer-panel-layout", "layer-preferences", "navigation-freshness", "pdf-share", "pencil-writing", "playback-preparation", "practice-focus", "reader-canvas-layering", "reader-experience", "reader-navigation", "reader-presentation", "reader-render-recovery", "reader-scrubber", "reader-settlement", "reader-status", "reader-text-layout", "reader-ux", "reader-zoom", "reading-state", "safe-area", "ui-simplification", "uiux-return", "upload-queue"],
  smoke: ["admin-workbench", "connection-sampling", "diagnostic-reports", "file-touch-links", "invite-connection-failover", "loading-stability", "musicxml-audio-startup", "musicxml-cursor-overflow", "musicxml-native-selection", "musicxml-playback", "musicxml-startup", "pdf-codecs-smoke", "playback-load-failure", "playback-ux", "practice-compare", "practice-loop", "practice-reader-layout", "practice-rhythm", "practice-score-entry", "practice-unified-controls"],
};

// Select the complete scope and reject empty shards. Visual tests retain
// native Node shards; the smoke runner partitions by recorded file cost.
export function selectBrowserTests({ suite, group = "all", shard = "1/1", entries }) {
  assert.ok(Object.hasOwn(library, suite), "Expected visual|smoke");
  assert.ok(["all", "library", "gate", "extended"].includes(group), "Unknown browser group");
  assert.match(shard, /^[1-9]\d*\/[1-9]\d*$/, "Expected shard index/count");
  const [index, count] = shard.split("/").map(Number);
  assert.ok(Number.isSafeInteger(index) && Number.isSafeInteger(count) && index <= count, "Invalid shard range");
  const available = [...new Set(entries.filter(file => file.endsWith(".test.mjs")))].sort();
  const deferred = extended[suite].map(name => `${name}.test.mjs`).sort();
  if (["gate", "extended", "library"].includes(group)) assert.ok(deferred.every(file => available.includes(file)), "Extended browser test file is missing");
  const files = group === "all" ? available : group === "gate" ? available.filter(file => !deferred.includes(file)) : group === "extended" ? deferred : library[suite].map(name => `${name}.test.mjs`).filter(file => !deferred.includes(file)).sort();
  assert.ok(files.length >= count, "Refusing empty browser test shards");
  assert.ok(files.every(file => available.includes(file)), "Selected browser test file is missing");
  return files;
}

// Rounded CI file costs (seconds), calibrated from run 40368368025. Keep the
// six-minute step budget: native filename round-robin put >360s in shard 1
// after one new filename shifted every subsequent heavy fixture.
const smokeCosts = {
  "access-smoke": 25,
  "admin-workbench": 35,
  "annotations-smoke": 20,
  "attachments-recovery": 30,
  "attachments-smoke": 40,
  "connections": 70,
  "connection-sampling": 50,
  "diagnostic-reports": 20,
  "file-touch-links": 40,
  "free-trial-smoke": 15,
  "install-onboarding-smoke": 20,
  "invite-entry-smoke": 25,
  "invite-connection-failover": 90,
  "loading-stability": 25,
  "musicxml-audio-startup": 40,
  "musicxml-cursor-overflow": 25,
  "musicxml-native-selection": 30,
  "musicxml-offline": 25,
  "musicxml-playback": 75,
  "musicxml-startup": 65,
  "offline-entry-smoke": 45,
  "outbox-browser": 5,
  "pdf-codecs-smoke": 45,
  "pdf-replacement-trash": 30,
  "playback-load-failure": 80,
  "playback-ux": 35,
  "practice-compare": 60,
  "practice-loop": 35,
  "practice-reader-layout": 35,
  "practice-rhythm": 50,
  "practice-score-entry": 30,
  "practice-unified-controls": 30,
  "preview-notes-smoke": 75,
  "release-channel-navigation": 20,
  "resilient-update": 70,
  "storage-smoke": 15
};

export function partitionSmokeTests(files, shard) {
  const [index, count] = shard.split("/").map(Number);
  const buckets = Array.from({ length: count }, () => ({ cost: 0, files: [] }));
  const cost = file => smokeCosts[file.replace(/\.test\.mjs$/, "")] ?? 25;
  for (const file of [...files].sort((a, b) => cost(b) - cost(a) || a.localeCompare(b))) {
    const bucket = buckets.reduce((best, candidate) => candidate.cost < best.cost ? candidate : best);
    bucket.files.push(file); bucket.cost += cost(file);
  }
  return buckets[index - 1].files.sort();
}
