import { alphaTab } from "@coderline/alphatab-vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

import { playbackAssets } from "./scripts/playback-assets";
import { shellManifest } from "./scripts/shell-manifest";
import { pdfJsAssets } from "./scripts/pdfjs-assets-plugin.ts";
import { formatBuildVersion } from "./scripts/build-version.mjs";

const buildId = process.env.SAME_PAGE_BUILD_ID
  ?? process.env.GITHUB_SHA
  ?? execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();

const builtAt = new Date();
const buildPublishedDate = builtAt.toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
const buildVersion = formatBuildVersion(builtAt);

const buildRunId = process.env.GITHUB_RUN_ID ?? "";

const testState = process.env.SAME_PAGE_TEST_STATE;
const testHeaders = testState ? { "x-same-page-test-server": process.env.SAME_PAGE_TEST_RUN! } : undefined;

export default defineConfig(({ isPreview, command }) => {
  const assetBase = command === "build" && process.env.SAME_PAGE_RELEASE_CHANNELS === "1" ? `/_releases/${buildId}/` : "/";
  return ({
  base: assetBase,
  ...(testState && isPreview ? { root: testState } : {}),
  ...(testState ? { cacheDir: `${testState}/vite-cache`, envDir: testState } : {}),
  server: { headers: testHeaders },
  preview: { headers: testHeaders },
  define: {
    __SAME_PAGE_BUILD_ID__: JSON.stringify(buildId),
    __SAME_PAGE_ASSET_BASE__: JSON.stringify(assetBase),
    __SAME_PAGE_RELEASE_CHANNELS__: JSON.stringify(process.env.SAME_PAGE_RELEASE_CHANNELS === "1"),
    __SAME_PAGE_BUILD_RUN_ID__: JSON.stringify(buildRunId),
    __SAME_PAGE_BUILD_PUBLISHED_DATE__: JSON.stringify(buildPublishedDate),
    __SAME_PAGE_BUILD_VERSION__: JSON.stringify(buildVersion),
  },
  build: {
    // The lazy reader contains the PDF.js display API (about 170 KiB gzip).
    // Keep the warning threshold explicit while the home/auth chunks remain
    // independent and much smaller.
    chunkSizeWarningLimit: 1500,
    rollupOptions: { output: { manualChunks(id) {
      if (/node_modules\/(?:@coderline\/alphatab|@clydian\/chorus-player|fflate|saxes|xmlchars)/.test(id)) return "musicxml-engine";
    } } },
  },
  plugins: [
    playbackAssets(buildId, assetBase),
    pdfJsAssets(),
    alphaTab(),
    {
      // Run before Cloudflare's terminal preview middleware; artifact hashing
      // below must still run after all build transforms.
      name: "same-page-preview-test-identity",
      enforce: "pre",
      configurePreviewServer(server) {
        if (testHeaders) server.middlewares.use((_request, response, next) => {
          response.setHeader("x-same-page-test-server", testHeaders["x-same-page-test-server"]);
          next();
        });
      },
    },
    {
      name: "same-page-build-identity",
      enforce: "post",
      transformIndexHtml() {
        return [{ tag: "meta", attrs: { name: "same-page-build-id", content: buildId }, injectTo: "head" }];
      },
      async writeBundle(options, bundle) {
        // Read final disk bytes after Vite's preload/import rewrites.
        const output = options.dir!;
        const scripts = Object.fromEntries(await Promise.all(Object.values(bundle)
          .filter((entry) => /\.(?:m?js)$/.test(entry.fileName))
          .map(async (entry) => [`${assetBase}${entry.fileName}`, createHash("sha256")
            .update(await readFile(path.join(output, entry.fileName))).digest("hex")])));
        await writeFile(path.join(output, "build.json"), `${JSON.stringify({ buildId, assetBase, version: buildVersion, builtAt: builtAt.toISOString(), runId: buildRunId, scripts })}\n`);
      },
    },
    react(),
    cloudflare(testState ? {
      persistState: { path: testState }, inspectorPort: false, remoteBindings: false,
    } : {}),
    VitePWA({
      base: "/",
      scope: "/",
      manifestFilename: "manifest.webmanifest",
      registerType: "prompt",
      injectRegister: false,
      strategies: "injectManifest",
      srcDir: "service-worker",
      filename: "sw.ts",
      includeManifestIcons: false,
      manifest: {
        name: "合谱 · Same Page",
        short_name: "合谱",
        description: "合唱乐谱与排练批注",
        theme_color: "#014653",
        background_color: "#ffffff",
        display: "standalone",
        id: "/",
        scope: "/",
        start_url: "/",
        icons: [
          {
            src: assetBase + "icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: assetBase + "icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: assetBase + "icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      injectManifest: {
        manifestTransforms: [entries => shellManifest(entries, undefined, buildId, assetBase)],
        globPatterns: ["**/*.{js,mjs,wasm,css,html,ico,png,webp,woff2,webmanifest}"],
        // Prepare MusicXML resources on demand. Do not download optional viewers
        // and editor on every PWA install; the main PDF engine stays precached.
        globIgnores: ["playback/**", "third-party/**","**/admin-*","assets/{shared-layers,personal-layer,replace-pdf,offline-sync}-animation-*.webp", "**/validate-musicxml-*","**/musicxml-*", "**/prepare.worker-*", "**/alphaTab.*", "font/**", "soundfont/**","**/markdown-editor-*", "**/markdown-attachment-*", "**/pdf-preview-*", "**/pdf_viewer-*", "**/attachment-dialog-*"],
        // PDF.js' worker is slightly larger than Workbox's 2 MiB default.
        // It is required to open a verified offline PDF, so keep it in the
        // application-shell precache rather than making offline claims depend
        // on whether the reader happened to load while online before.
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      },
    }),
  ],
});
});
