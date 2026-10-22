import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { chromium, webkit } from "playwright";

// Never repair this environment with apt or a browser download. Update the
// pinned workflow images together with Playwright in package-lock.json.
const require = createRequire(import.meta.url);
const { version } = require("playwright-core/package.json");
const locked = JSON.parse(readFileSync(new URL("../../package-lock.json", import.meta.url), "utf8"));
const image = JSON.parse(readFileSync("/ms-playwright/.docker-info", "utf8"));
assert.equal(version, locked.packages["node_modules/playwright-core"].version);
assert.equal(image.driverVersion, version, "Update every workflow's Playwright image and digest to match package-lock.json");

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
