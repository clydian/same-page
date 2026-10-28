import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { precacheBudgetBytes, verifyPrecache } from "./verify-precache.mjs";
import { pdfJsDecoderFiles, pdfJsLicenseFiles, pdfJsWasmDirectory } from "../src/shared/pdfjs-assets.ts";

it("rejects leaked design sources, missing offline dependencies and oversized or eager precaches", async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), "precache-audit-"));
  const output = path.join(temporary, "published"), design = path.join(temporary, "design");
  try {
    await mkdir(output); await mkdir(design);
    await writeFile(path.join(design, "original.png"), "design pixels");
    const required = ["index.html", "favicon-32.png", "apple-touch-icon.png", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "pdf.worker-current.mjs", "playback/test/manifest.json", "assets/musicxml-player-test.js", "assets/audio-player-test.js", "assets/prepare.worker-test.js", "playback/test/soundfont/sonivox.sf2"];
    const decoders = pdfJsDecoderFiles.map(name => pdfJsWasmDirectory + name);
    await mkdir(path.join(output, pdfJsWasmDirectory), { recursive: true });
    for (const name of [...decoders, ...pdfJsLicenseFiles.map(name => pdfJsWasmDirectory + name)]) await writeFile(path.join(output, name), "decoder asset");
    await mkdir(path.join(output, 'assets'));
    await mkdir(path.join(output, 'playback/test/soundfont'), { recursive: true });
    for (const file of required) await writeFile(path.join(output, file), "runtime asset");
    const { createHash } = await import('node:crypto');
    const playerEntries = required.filter(file => /(?:assets|soundfont)\//.test(file)).map(url => ({url:'/'+url,bytes:13,integrity:'sha256-'+createHash('sha256').update('runtime asset').digest('base64')}));
    await writeFile(path.join(output, 'playback/test/manifest.json'), JSON.stringify({buildId:'test',entries:playerEntries}));
    const manifest = files => `precacheAndRoute([${files.map(url => `{url:"${url}",revision:null}`).join(",")}])`;
    await writeFile(path.join(output, "sw.js"), manifest([...required, ...decoders]));
    await expect(verifyPrecache(output, design)).resolves.toMatchObject({ entries: required.length + decoders.length });
    await mkdir(path.join(output, "third-party/alphatab"), { recursive: true });
    await writeFile(path.join(output, "third-party/alphatab/source.json"), "source manifest");
    await writeFile(path.join(output, "sw.js"), manifest([...required, ...decoders, "third-party/alphatab/source.json"]));
    await expect(verifyPrecache(output, design)).rejects.toThrow("Third-party sources must remain on demand");
    await writeFile(path.join(output, "sw.js"), manifest([...required, ...decoders]));
    await writeFile(path.join(output, "sw.js"), manifest([...required.filter(file=>!file.includes('musicxml-player-test')), ...decoders]));
    await expect(verifyPrecache(output, design)).rejects.toThrow('Playback resource not precached');
    await writeFile(path.join(output, "sw.js"), manifest([...required, ...decoders]));
    const uniqueReport = await verifyPrecache(output, design);
    await writeFile(path.join(output, "sw.js"), manifest([...required, ...decoders, ...required]));
    await expect(verifyPrecache(output, design)).resolves.toEqual(uniqueReport);
    const animation = "shared-layers-animation-current.webp";
    await writeFile(path.join(output, animation), "animation pixels");
    await writeFile(path.join(output, "sw.js"), manifest([...required, ...decoders, animation]));
    await expect(verifyPrecache(output, design)).rejects.toThrow("Homepage animations must remain on demand");
    const illustration = "shared-layers-current.webp";
    await writeFile(path.join(output, illustration), "static pixels");
    await writeFile(path.join(output, "sw.js"), manifest([...required, ...decoders]));
    await expect(verifyPrecache(output, design)).rejects.toThrow("Static illustration not precached");
    await writeFile(path.join(output, "sw.js"), manifest([...required, ...decoders, illustration]));
    await expect(verifyPrecache(output, design)).resolves.toHaveProperty("budgetBytes", precacheBudgetBytes);
    await writeFile(path.join(output, "index.html"), Buffer.alloc(precacheBudgetBytes));
    await expect(verifyPrecache(output, design)).rejects.toThrow("Precache exceeds byte budget");
    await writeFile(path.join(output, "index.html"), "runtime asset");
    await rm(path.join(output, illustration));
    for (const decoder of decoders) {
      await writeFile(path.join(output, "sw.js"), manifest([...required, ...decoders.filter(name => name !== decoder)]));
      await expect(verifyPrecache(output, design)).rejects.toThrow("PDF decoder not precached");
    }
    await writeFile(path.join(output, "sw.js"), manifest([...required, ...decoders]));
    await writeFile(path.join(output, "renamed.png"), "design pixels");
    await expect(verifyPrecache(output, design)).rejects.toThrow("Design source published");
    await rm(path.join(output, "renamed.png"));
    await writeFile(path.join(output, "sw.js"), manifest(required.filter(file => !file.startsWith("pdf.worker"))));
    await expect(verifyPrecache(output, design)).rejects.toThrow("PDF worker not precached");
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
