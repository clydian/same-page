import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, stat, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pdfJsDecoderFiles, pdfJsLicenseFiles, pdfJsWasmDirectory } from "../src/shared/pdfjs-assets.ts";

async function files(root) {
  const entries = await readdir(root, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => entry.isDirectory() ? files(path.join(root, entry.name)) : [path.join(root, entry.name)]))).flat();
}
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
// Keep headroom above the ~6.5 MB shell after removing optional animations.
// Review the offline dependencies before deliberately raising this budget.
export const precacheBudgetBytes = 7 * 1024 * 1024;
export async function verifyPrecache(root = "dist/client", designRoot = "design") {
  const designHashes = new Set(await Promise.all((await files(designRoot)).filter((file) => !file.endsWith(".md")).map(async (file) => digest(await readFile(file)))));
  const published = await files(root);
  for (const file of published) assert.ok(!designHashes.has(digest(await readFile(file))), `Design source published: ${file}`);
  const worker = await readFile(path.join(root, "sw.js"), "utf8");
  // Workbox merges identical URLs (e.g. includeAssets and globbed icons).
  // Charge the budget once per stored file, rather than per manifest record.
  const entries = [...new Set([...worker.matchAll(/\{url:"([^"]+)",revision:(?:"[^"]+"|null)\}/g)].map((match) => match[1]))];
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
  assert.ok(!entries.some(file => /musicxml-|validate-musicxml-|alphaTab\.|prepare\.worker-|^font\/|^soundfont\//.test(file)), "MusicXML resources must remain on demand");
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
