import assert from "node:assert/strict";

// Top-level test durations (seconds), summed per file from main run 38049682737.
// These are scheduling hints, not timing assertions. New files get a default weight.
const durations = {
  "visual": {
    "auth-methods.test.mjs": 13,
    "continuous-reader-layout.test.mjs": 18,
    "diagnostics.test.mjs": 4,
    "drive-library-lifecycle.test.mjs": 14,
    "drive-navigation.test.mjs": 36,
    "drive-settings.test.mjs": 17,
    "experience-continuity.test.mjs": 6,
    "highlighter-nib.test.mjs": 18,
    "highlighter-regression.test.mjs": 22,
    "homepage-responsive.test.mjs": 3,
    "layer-panel-layout.test.mjs": 7,
    "layer-preferences.test.mjs": 31,
    "navigation-freshness.test.mjs": 9,
    "pdf-export.test.mjs": 14,
    "pdf-share.test.mjs": 22,
    "pencil-writing.test.mjs": 22,
    "reader-annotation-stability.test.mjs": 15,
    "reader-canvas-layering.test.mjs": 1,
    "reader-conflicts.test.mjs": 35,
    "reader-experience.test.mjs": 47,
    "reader-immersive.test.mjs": 52,
    "reader-mobile-editing.test.mjs": 58,
    "reader-navigation.test.mjs": 34,
    "reader-presentation.test.mjs": 19,
    "reader-scrubber.test.mjs": 8,
    "reader-settlement.test.mjs": 74,
    "reader-status.test.mjs": 5,
    "reader-text-layout.test.mjs": 2,
    "reader-ux.test.mjs": 23,
    "reader-zoom.test.mjs": 49,
    "reading-state.test.mjs": 6,
    "responsive-navigation.test.mjs": 16,
    "safe-area.test.mjs": 12,
    "shared-layer-management.test.mjs": 4,
    "ui-simplification.test.mjs": 8,
    "uiux-return.test.mjs": 26,
    "update-safety.test.mjs": 8,
    "upload-queue.test.mjs": 5,
    "visual-report.test.mjs": 1
  },
  "smoke": {
    "access-smoke.test.mjs": 11,
    "annotations-smoke.test.mjs": 8,
    "attachments-recovery.test.mjs": 17,
    "attachments-smoke.test.mjs": 25,
    "diagnostic-reports.test.mjs": 8,
    "free-trial-smoke.test.mjs": 6,
    "install-onboarding-smoke.test.mjs": 9,
    "invite-entry-smoke.test.mjs": 13,
    "loading-stability.test.mjs": 18,
    "musicxml-playback.test.mjs": 45,
    "offline-entry-smoke.test.mjs": 31,
    "outbox-browser.test.mjs": 1,
    "pdf-codecs-smoke.test.mjs": 20,
    "storage-smoke.test.mjs": 6
  }
};

const library = {
  visual: ["drive-settings", "drive-navigation", "drive-library-lifecycle", "upload-queue", "responsive-navigation", "shared-layer-management"],
  smoke: ["storage-smoke", "offline-entry-smoke"],
};

export function planBrowserTests({ suite, group = "all", shard = "1/1", entries }) {
  assert.ok(Object.hasOwn(library, suite), "Expected visual|smoke");
  assert.ok(["all", "library"].includes(group), "Expected all|library");
  assert.match(shard, /^[1-9]\d*\/[1-9]\d*$/, "Expected shard index/count");
  const [index, count] = shard.split("/").map(Number);
  assert.ok(Number.isSafeInteger(index) && Number.isSafeInteger(count) && index <= count, "Invalid shard range");
  const available = [...new Set(entries.filter(file => file.endsWith(".test.mjs")))].sort();
  const files = group === "all" ? available : library[suite].map(name => `${name}.test.mjs`).sort();
  assert.ok(files.length >= count, "Refusing empty browser test shards");
  assert.ok(files.every(file => available.includes(file)), "Selected browser test file is missing");
  const weight = file => durations[suite][file] ?? 10;
  const shards = Array.from({ length: count }, () => ({ files: [], seconds: 0 }));
  for (const file of [...files].sort((a, b) => weight(b) - weight(a) || a.localeCompare(b, "en"))) {
    const target = shards.reduce((best, next) => next.seconds < best.seconds ? next : best);
    target.files.push(file);
    target.seconds += weight(file);
  }
  return shards[index - 1].files.sort();
}
