import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { getManifest } from "workbox-build";

const require = createRequire(import.meta.url);
const consumers = ["eslint", "@eslint/config-array", "@typescript-eslint/typescript-estree", "glob"];

it("the lockfile contains no minimatch versions affected by GHSA-g3hv-75wg-m249", async () => {
  const lock = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"));
  const affected = Object.entries(lock.packages).filter(([name, entry]) => {
    if (!name.endsWith("/minimatch")) return false;
    const [major, minor, patch] = entry.version.split(".").map(Number);
    return major >= 7 && (major < 11 || (major === 11 && minor === 0 && patch < 1));
  });
  expect(affected).toEqual([]);
});

it.each(consumers)("%s resolves a bounded matcher and preserves file matching", (consumer) => {
  const consumerRequire = createRequire(require.resolve(consumer));
  const { Minimatch, minimatch } = consumerRequire("minimatch");
  expect(Number(consumerRequire("minimatch/package.json").version.split(".")[0])).toBe(11);
  const matcher = new Minimatch("**/*.{ts,tsx}", { dot: true });
  expect(matcher.match("src/client/reader.tsx")).toBe(true);
  expect(matcher.match("src/client", true)).toBe(true);
  expect(matcher.match("src/client/reader.js")).toBe(false);
  expect(minimatch(".config.ts", "*.ts", { dot: true })).toBe(true);
  const bounded = new Minimatch(Array(12).fill("**/../a/b").join("/"), {
    optimizationLevel: 2, braceExpandMax: 64,
  });
  expect(bounded.set.length).toBeLessThanOrEqual(64);
});

it("Workbox discovers nested shell files while excluding on-demand assets", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "same-page-globs-"));
  try {
    const files = ["index.html", "assets/app.js", "assets/style.css", "assets/pdf.worker.mjs",
      "assets/decode.wasm", "assets/illustration.webp", "assets/admin-panel.js",
      "assets/shared-layers-animation-123.webp", "playback/player.js", "third-party/source.js"];
    for (const file of files) {
      await mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await writeFile(path.join(root, file), file);
    }
    const { manifestEntries, warnings } = await getManifest({
      globDirectory: root,
      globPatterns: ["**/*.{js,mjs,wasm,css,html,webp}"],
      globIgnores: ["playback/**", "third-party/**", "**/admin-*", "assets/{shared-layers,personal-layer}-animation-*.webp"],
    });
    expect(warnings).toEqual([]);
    expect(manifestEntries.map(entry => entry.url).sort()).toEqual([
      "assets/app.js", "assets/decode.wasm", "assets/illustration.webp", "assets/pdf.worker.mjs", "assets/style.css", "index.html",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
