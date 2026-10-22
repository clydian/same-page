import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { cp, mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

import { chromium, webkit } from "@playwright/test";
import { observeInitialUpdateCheck, waitForInitialUpdateCheck } from "./pwa-update-readiness.mjs";

const repositoryRoot = process.cwd();
const temporaryRoot = await mkdtemp(path.join(tmpdir(), "same-page-pwa-update-"));
const builds = {
  first: path.join(temporaryRoot, "first"),
  second: path.join(temporaryRoot, "second"),
};
const buildIds = {
  first: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  second: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
};

let activeBuild = builds.first;
let browser;
let server;
const animationRequests = [];
let failAnimationRequests = false;
let preparationGate;
let releasePreparation;

try {
  await buildVersion(buildIds.first, builds.first);
  await buildVersion(buildIds.second, builds.second);

  server = createServer((request, response) => {
    void serveRequest(request, response, activeBuild);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;

  for (const engine of [chromium, webkit]) {
    const animationBrowser = await engine.launch({ headless: true });
    try {
      await verifyAnimationCaching(animationBrowser, origin);
    } finally {
      await animationBrowser.close();
    }
  }

  browser = await webkit.launch({ headless: true });
  const context = await browser.newContext({ serviceWorkers: "allow" });
  await context.addInitScript(observeInitialUpdateCheck);
  const page = await context.newPage();

  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    (expected) => document.documentElement.dataset.buildId === expected,
    buildIds.first,
  );
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));

  const editingWindow = await context.newPage();
  await editingWindow.goto(`${origin}/login`, { waitUntil: "domcontentloaded" });
  await editingWindow.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await page.goto(`${origin}/about`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "检查更新", exact: true }).waitFor();
  // A controller may precede this window's application registration callback.
  // Finish both automatic checks against A before offering/gating candidate B.
  await Promise.all([waitForInitialUpdateCheck(page, "about window"), waitForInitialUpdateCheck(editingWindow, "login window")]);
  activeBuild = builds.second;
  // Hold a required precache response to exercise the actual installing worker.
  preparationGate = new Promise(resolve => { releasePreparation = resolve; });
  await page.getByRole("button", { name: "检查更新", exact: true }).click();
  await page.getByText("正在准备更新…，可以继续使用", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "准备中…", exact: true }).isDisabled(), true);
  assert.equal(await page.getByText("检查完成，当前版本继续运行", { exact: true }).count(), 0);
  await page.evaluate(() => {
    window.dispatchEvent(new Event("same-page-check-update"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.getByText("正在准备更新…，可以继续使用", { exact: true }).waitFor();
  releasePreparation(); preparationGate = undefined;
  await page.getByText("更新已准备好", { exact: true }).waitFor();
  await waitForPage(page, async () => Boolean((await navigator.serviceWorker.getRegistration())?.waiting));
  // A second window with an unfinished login form vetoes every candidate page.
  await page.waitForTimeout(5000);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.buildId), buildIds.first);
  assert.equal(await editingWindow.evaluate(() => document.documentElement.dataset.buildId), buildIds.first);
  assert.equal(await page.getByText("有新版本可用", { exact: true }).count(), 0);
  await page.goto(`${origin}/about`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "重新加载并更新" }).click();
  await page.getByText("请先在其他合谱窗口完成操作并返回文件库，或关闭那些窗口，再重试", { exact: true }).waitFor();
  await page.setViewportSize({ width: 320, height: 640 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.screenshot({ path: "artifacts/verification/update-feedback/webkit-blocked-mobile.png", fullPage: true });

  assert.equal(await page.evaluate(() => document.documentElement.dataset.buildId), buildIds.first);
  const legacySafe = await page.evaluate(async () => {
    const waiting = (await navigator.serviceWorker.getRegistration()).waiting;
    return new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      const timeout = setTimeout(() => { channel.port1.close(); reject(new Error("legacy request unanswered")); }, 3000);
      channel.port1.onmessage = event => { clearTimeout(timeout); channel.port1.close(); resolve(event.data?.safe); };
      waiting.postMessage({ type: "SAME_PAGE_SAFE_UPDATE" }, [channel.port2]);
    });
  });
  assert.equal(legacySafe, false, "legacy idle requests must not activate a prepared update");
  assert.equal(await page.evaluate(() => document.documentElement.dataset.buildId), buildIds.first);
  // Closing the unsafe window makes the idle about page eligible for automatic
  // handover. No update-button click is needed after that point.
  await editingWindow.close();
  await page.waitForFunction(
    (expected) => document.documentElement.dataset.buildId === expected,
    buildIds.second,
  );
  assert.equal(
    await page.evaluate(() => document.documentElement.dataset.buildId),
    buildIds.second,
  );
  assert.equal(
    await page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
    true,
  );

  await context.close();
  // Normal updates require no update-button click: the browser takes over once
  // every old application window exits, even with our forced-activation guard.
  activeBuild = builds.first;
  const automatic = await browser.newContext({ serviceWorkers: "allow" });
  const running = await automatic.newPage();
  await running.goto(`${origin}/about`, { waitUntil: "domcontentloaded" });
  await running.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await running.reload({ waitUntil: "domcontentloaded" });
  await running.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  assert.equal(await running.evaluate(() => document.documentElement.dataset.buildId), buildIds.first);
  const remaining = await automatic.newPage();
  await remaining.goto(`${origin}/login`, { waitUntil: "domcontentloaded" });
  await remaining.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  activeBuild = builds.second;
  // The product's foreground check discovers the new build automatically.
  await running.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await running.getByText("更新已准备好", { exact: true }).waitFor();
  await running.close();
  const stillRunning = await automatic.newPage();
  await stillRunning.goto(`${origin}/about`, { waitUntil: "domcontentloaded" });
  assert.equal(await stillRunning.evaluate(() => document.documentElement.dataset.buildId), buildIds.first,
    "another open application window must retain the current worker");
  await remaining.close();
  await stillRunning.close();
  const restarted = await automatic.newPage();
  await restarted.goto(`${origin}/about`, { waitUntil: "domcontentloaded" });
  assert.equal(await restarted.evaluate(() => document.documentElement.dataset.buildId), buildIds.second,
    "a prepared update must apply automatically after all old windows exit");
  // WebKit can open this network-loaded B document while the last A client
  // is still being released. Activation does not claim an uncontrolled page:
  // our worker deliberately has no clients.claim(). Keep the immediate B
  // assertion above, then verify control on the next navigation after activation.
  await waitForPage(restarted, async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return !registration?.waiting && registration?.active?.state === "activated";
  });
  await restarted.reload({ waitUntil: "domcontentloaded" });
  await restarted.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  assert.equal(await restarted.evaluate(() => document.documentElement.dataset.buildId), buildIds.second);
  const controllerBuild = await restarted.evaluate(() => new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timeout = setTimeout(() => { channel.port1.close(); reject(new Error("restarted controller unanswered")); }, 3000);
    channel.port1.onmessage = event => { clearTimeout(timeout); channel.port1.close(); resolve(event.data?.buildId); };
    navigator.serviceWorker.controller.postMessage({ type: "SAME_PAGE_SHELL_IDENTITY" }, [channel.port2]);
  }));
  assert.equal(controllerBuild, buildIds.second, "the restarted window must be controlled by B");
  await automatic.close();

  // Apply in the installed statechange, before Workbox's delayed waiting
  // notification can attach its controlling listener. The native event must
  // still finish the guarded reload.
  activeBuild = builds.first;
  const fastContext = await browser.newContext({ serviceWorkers: "allow" });
  const fast = await fastContext.newPage();
  await fast.goto(`${origin}/about`, { waitUntil: "domcontentloaded" });
  await waitForPage(fast, async () => (await navigator.serviceWorker.getRegistration())?.active?.state === "activated");
  await fast.reload({ waitUntil: "domcontentloaded" });
  await fast.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await fast.getByRole("button", { name: "检查更新", exact: true }).waitFor();
  await fast.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      worker.addEventListener("statechange", () => {
        if (worker.state === "installed") window.dispatchEvent(new Event("same-page-apply-update"));
      });
    });
  });
  activeBuild = builds.second;
  await fast.getByRole("button", { name: "检查更新", exact: true }).click();
  await fast.waitForFunction(expected => document.documentElement.dataset.buildId === expected, buildIds.second);
  await fastContext.close();
  process.stdout.write("Verified immediate manual handover before library waiting notification\n");
  process.stdout.write("Verified automatic restart updates and optional live-window handover\n");
} finally {
  releasePreparation?.();
  await browser?.close();
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await rm(temporaryRoot, { recursive: true, force: true });
}

async function verifyAnimationCaching(browser, origin) {
  const context = await browser.newContext({ serviceWorkers: "allow", reducedMotion: "reduce" });
  let sourceStopped = false;
  try {
    const page = await context.newPage();
    const requestStart = animationRequests.length;
    await page.goto(origin, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    const buttons = page.locator(".marketing-animation");
    await buttons.first().waitFor();
    assert.equal(await buttons.count(), 4);
    await buttons.first().scrollIntoViewIfNeeded();
    await waitForImage(page, 0, false);
    assert.equal(animationRequests.length, requestStart, "install and reduced motion must not fetch animations");

    // Entering the viewport with motion enabled loads exactly the viewed demo.
    // Reduced-motion visibility already consumes the one-shot observer, so
    // remount the home route to exercise its ordinary automatic playback.
    await page.getByRole("link", { name: "关于与更新", exact: true }).click();
    await page.getByRole("heading", { name: "关于合谱", exact: true }).waitFor();
    await page.setViewportSize({ width: 320, height: 640 });
    const status = page.getByRole("status");
    await status.filter({ hasText: "检查完成，当前版本继续运行" }).waitFor();
    assert.equal(await status.getAttribute("aria-live"), "polite");
    assert.equal(await status.getAttribute("aria-atomic"), "true");
    const updateSection = page.locator("section").filter({ has: page.getByRole("heading", { name: "更新检查已完成", exact: true }) });
    assert.equal(await updateSection.getByRole("button").count(), 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true,
      "update details must fit a 320px mobile viewport");
    await mkdir("artifacts/verification/update-feedback", { recursive: true });
    await page.screenshot({ path: `artifacts/verification/update-feedback/${browser.browserType().name()}-mobile.png`, fullPage: true });

    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.getByRole("button", { name: "返回", exact: true }).click();
    await buttons.first().waitFor();
    await buttons.first().scrollIntoViewIfNeeded();
    await waitForImage(page, 0, true);
    await waitForPage(page, async () => (await (await caches.open("same-page-home-animations")).keys()).length === 1);
    assert.equal(animationRequests.length, requestStart + 1, "only the visible animation should download");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await waitForImage(page, 0, false);

    // Use a stopped source for WebKit, matching the offline PDF smoke contract.
    // Stop it in both engines; Chromium additionally uses its offline flag.
    await new Promise(resolve => server.close(resolve));
    sourceStopped = true;
    if (browser.browserType().name() === "chromium") await context.setOffline(true);
    await buttons.first().click();
    await waitForImage(page, 0, true);
    assert.equal(animationRequests.length, requestStart + 1, "offline replay must use the runtime cache");
    await waitForImage(page, 0, false);

    await buttons.nth(1).scrollIntoViewIfNeeded();
    const offlineFailure = page.waitForEvent("requestfailed", {
      predicate: request => request.url().includes("personal-layer-animation-"),
    });
    await buttons.nth(1).click();
    await offlineFailure;
    await waitForImage(page, 1, false);
    assert.equal(await page.evaluate(async () => (await (await caches.open("same-page-home-animations")).keys()).length), 1);

    await context.setOffline(false);
    await restartSource(origin);
    sourceStopped = false;
    failAnimationRequests = true;
    const failedResponse = page.waitForResponse(response => response.url().includes("personal-layer-animation-") && response.status() === 503);
    await buttons.nth(1).click();
    await failedResponse;
    await waitForImage(page, 1, false);
    failAnimationRequests = false;
    await buttons.nth(1).click();
    await waitForImage(page, 1, true);
    await waitForPage(page, async () => (await (await caches.open("same-page-home-animations")).keys()).length === 2);
    process.stdout.write(`Verified on-demand animation cache and static offline fallback (${browser.browserType().name()})\n`);
  } finally {
    failAnimationRequests = false;
    await context.close();
    if (sourceStopped) await restartSource(origin);
  }
}

async function restartSource(origin) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(Number(new URL(origin).port), "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

async function waitForImage(page, index, animated) {
  await page.waitForFunction(({ index, animated }) => {
    const image = document.querySelectorAll(".marketing-animation img")[index];
    return image?.src.startsWith("blob:") === animated && image.complete && image.naturalWidth > 0;
  }, { index, animated });
}

async function buildVersion(buildId, destination) {
  const executable = process.platform === "win32" ? "npm.cmd" : "npm";
  execFileSync(executable, ["run", "build"], {
    cwd: repositoryRoot,
    env: { ...process.env, SAME_PAGE_BUILD_ID: buildId },
    stdio: "pipe",
  });
  await cp(path.join(repositoryRoot, "dist/client"), destination, {
    recursive: true,
  });
}

async function serveRequest(request, response, root) {
  try {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    if (root === builds.second && requestUrl.pathname === "/") await preparationGate;
    if (requestUrl.pathname.startsWith("/api/")) {
      serveApi(requestUrl.pathname, response);
      return;
    }
    if (/-animation-[^/]+\.webp$/.test(requestUrl.pathname)) {
      animationRequests.push(requestUrl.pathname);
      if (failAnimationRequests) {
        response.statusCode = 503;
        response.end("Animation temporarily unavailable");
        return;
      }
    }

    const requestedPath = requestUrl.pathname === "/"
      ? "index.html"
      : requestUrl.pathname.slice(1);
    let filePath = safeAssetPath(root, requestedPath);
    try {
      if (!(await stat(filePath)).isFile()) throw new Error("not a file");
    } catch {
      filePath = path.join(root, "index.html");
    }
    const extension = path.extname(filePath);
    response.statusCode = 200;
    response.setHeader("Content-Type", contentType(extension));
    response.setHeader(
      "Cache-Control",
      requestedPath.startsWith("assets/")
        ? "public, max-age=31536000, immutable"
        : "no-cache",
    );
    createReadStream(filePath).pipe(response);
  } catch (error) {
    response.statusCode = 500;
    response.end(error instanceof Error ? error.message : "server error");
  }
}

function safeAssetPath(root, requestedPath) {
  const resolved = path.resolve(root, requestedPath);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Unsafe asset path");
  }
  return resolved;
}

function serveApi(pathname, response) {
  response.statusCode = 200;
  response.setHeader("Content-Type", "application/json");
  response.setHeader("Cache-Control", "no-store");
  if (pathname === "/api/auth/get-session") {
    response.end("null");
    return;
  }
  if (pathname === "/api/auth/social-providers") {
    response.end('{"providers":[]}');
    return;
  }
  if (pathname === "/api/guest/preview-choir") {
    response.end('{"error":"not_found"}');
    return;
  }
  response.statusCode = 404;
  response.end('{"error":"not_found"}');
}

function contentType(extension) {
  return {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".png": "image/png",
    ".webp": "image/webp",
    ".webmanifest": "application/manifest+json",
  }[extension] ?? "application/octet-stream";
}

async function waitForPage(page, predicate) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await page.evaluate(predicate)) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for asynchronous browser state");
}
