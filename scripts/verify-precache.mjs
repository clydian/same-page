import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, stat, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pdfJsDecoderFiles, pdfJsLicenseFiles, pdfJsWasmDirectory } from "../src/shared/pdfjs-assets.ts";
import { applicationShellReleaseLimitBytes } from "../src/shared/update-diagnostics.ts";

async function files(root) {
  const entries = await readdir(root, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => entry.isDirectory() ? files(path.join(root, entry.name)) : [path.join(root, entry.name)]))).flat();
}
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
// Match installer admission: the required shell now includes playback.
export const precacheBudgetBytes = applicationShellReleaseLimitBytes;
export async function verifyPrecache(root = "dist/client", designRoot = "design") {
  const designHashes = new Set(await Promise.all((await files(designRoot)).filter((file) => !file.endsWith(".md")).map(async (file) => digest(await readFile(file)))));
  const published = await files(root);
  for (const file of published) assert.ok(!designHashes.has(digest(await readFile(file))), `Design source published: ${file}`);
  const worker = await readFile(path.join(root, "sw.js"), "utf8");
  // Workbox merges identical URLs (e.g. includeAssets and globbed icons).
  // Charge the budget once per stored file, rather than per manifest record.
  let manifest;
  try { manifest = JSON.parse(await readFile(path.join(root, "shell-manifest.json"), "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const localFile = url => url === "/" ? "index.html" : url.replace(/^\/_releases\/[a-f0-9]{7,40}\//, "").replace(/^\//, "");
  if (manifest) for (const entry of manifest) {
    const bytes = await readFile(path.join(root, localFile(entry.url)));
    assert.equal(entry.integrity, `sha256-${createHash("sha256").update(bytes).digest("base64")}`, `Shell integrity mismatch: ${entry.url}`);
    assert.equal(entry.bytes, bytes.byteLength, `Shell size mismatch: ${entry.url}`);
    assert.ok(worker.includes(entry.integrity), `Shell entry not injected: ${entry.url}`);
  }
  const entries = [...new Set(manifest ? manifest.map(entry => localFile(entry.url))
    : [...worker.matchAll(/\{url:"([^"]+)",revision:(?:"[^"]+"|null)\}/g)].map(match => match[1]))];
  assert.ok(entries.length > 0, "Generated precache manifest not found");
  for (const required of ["index.html", "favicon-32.png", "apple-touch-icon.png", "icon-192.png", "icon-512.png", "icon-maskable-512.png"]) assert.ok(entries.includes(required), `Missing offline dependency: ${required}`);
  assert.ok(entries.some((file) => /pdf\.worker.*\.mjs$/.test(file)), "PDF worker not precached");
  for (const name of pdfJsDecoderFiles) {
    assert.ok(entries.includes(pdfJsWasmDirectory + name), `PDF decoder not precached: ${name}`);
  }
  for (const name of pdfJsLicenseFiles) {
    assert.ok(published.includes(path.join(root, pdfJsWasmDirectory, name)), `PDF decoder license not published: ${name}`);
  }
  for (const file of published.filter((file) => file.endsWith(".woff2") && !file.includes("/font/"))) assert.ok(entries.includes(path.relative(root, file)), `Font not precached: ${file}`);
  const playerManifests = published.filter(file => /\/playback\/[^/]+\/manifest\.json$/.test(file));
  assert.equal(playerManifests.length, 1, "Expected one required playback manifest");
  for (const file of playerManifests) {
    assert.ok(entries.includes(path.relative(root, file)), "Playback manifest not precached");
    const player = JSON.parse(await readFile(file, "utf8"));
    assert.ok(player.entries.some(entry => /musicxml-player-/.test(entry.url)), "MusicXML player missing from release");
    assert.ok(entries.some(file => /audio-player-/.test(file)), "Audio player missing from release");
    assert.ok(player.entries.some(entry => /prepare\.worker-/.test(entry.url)), "Playback preparation worker missing from release");
    assert.ok(player.entries.some(entry => entry.url.endsWith("/sonivox.sf2")), "Playback soundfont missing from release");
    for (const entry of player.entries) {
      assert.ok(entries.includes(localFile(entry.url)), `Playback resource not precached: ${entry.url}`);
      const bytes = await readFile(path.join(root, localFile(entry.url)));
      assert.equal(entry.bytes, bytes.byteLength, `Playback size mismatch: ${entry.url}`);
      assert.equal(entry.integrity, `sha256-${createHash("sha256").update(bytes).digest("base64")}`, `Playback integrity mismatch: ${entry.url}`);
    }
  }
  assert.ok(!entries.some(file => /^third-party\//.test(file)), "Third-party sources must remain on demand");
  assert.ok(!entries.some(file => /(?:^|\/)admin-/.test(file)), "Product admin resources must remain on demand");
  assert.ok(!entries.some(file => /-animation-[^/]+\.webp$/.test(file)), "Homepage animations must remain on demand");
  for (const file of published.filter(file => /\.webp$/.test(file) && !/-animation-[^/]+\.webp$/.test(file))) {
    assert.ok(entries.includes(path.relative(root, file)), `Static illustration not precached: ${file}`);
  }
  const bytes = (await Promise.all(entries.map(async (file) => (await stat(path.join(root, file))).size))).reduce((a, b) => a + b, 0);
  assert.ok(bytes <= precacheBudgetBytes, `Precache exceeds byte budget: ${bytes} > ${precacheBudgetBytes}`);
  // Preserve the historical audit as a reference, but do not subtract metrics
  // that used manifest records from today's unique-file accounting.
  const report = { entries: entries.length, bytes, budgetBytes: precacheBudgetBytes, accounting: "unique-urls", baseline: { entries: 60, bytes: 5403008, accounting: "manifest-records" } };
  return report;
}
if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const report = await verifyPrecache();
  await mkdir("artifacts/verification", { recursive: true });
  await writeFile("artifacts/verification/precache-136.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
