import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { chromium, webkit } from "playwright";

// Never repair this environment with apt or a browser download. Update the
// pinned workflow images together with Playwright in package-lock.json.
const require = createRequire(import.meta.url);
const { version } = require("playwright-core/package.json");
const locked = JSON.parse(readFileSync(new URL("../../package-lock.json", import.meta.url), "utf8"));
const image = JSON.parse(readFileSync("/ms-playwright/.docker-info", "utf8"));
assert.equal(version, locked.packages["node_modules/playwright-core"].version);
assert.equal(image.driverVersion, version, "Update every workflow's Playwright image and digest to match package-lock.json");

// #564: older Linux bundles can corrupt the SoupSession feature list after an
// async read error. Verify the shipped library, rather than just the SDK tag.
const soupPath = path.join(path.dirname(webkit.executablePath()), "minibrowser-wpe/sys/lib/libsoup-3.0.so.0");
const soupVersion = readFileSync(soupPath).toString("latin1").match(/libsoup\/(\d+)\.(\d+)\.(\d+)/);
assert.ok(soupVersion, `Cannot identify bundled libsoup: ${soupPath}`);
const [major, minor, patch] = soupVersion.slice(1).map(Number);
assert.ok(major > 3 || (major === 3 && (minor > 6 || (minor === 6 && patch >= 6))),
  `Bundled ${soupVersion[0]} predates the session feature lifetime fix (3.6.6)`);
console.log(`WebKit bundled ${soupVersion[0]} verified`);

// Failed browser tests sanitize their traces with Python; check that path too.
execFileSync("python3", ["--version"], { stdio: "inherit" });
for (const engine of [chromium, webkit]) {
  const browser = await engine.launch();
  try {
    const page = await browser.newPage();
    await page.setContent("<p>Same Page browser environment</p>");
    assert.equal(await page.locator("p").textContent(), "Same Page browser environment");
    console.log(`${engine.name()} ${browser.version()} ready; Playwright ${version}, Node ${process.versions.node}`);
  } finally {
    await browser.close();
  }
}
