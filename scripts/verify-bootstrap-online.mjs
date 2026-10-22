import assert from "node:assert/strict";
import { createServer } from "node:http";
import { connect } from "node:net";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const productionOrigin = "https://samepage.clyapps.com";
const evidencePath = "artifacts/verification/bootstrap-online.json";
const contract = "same-page-storage-v15-sync-v1";

export function bootstrapArguments(args) {
  assert.equal(args.length, 1, "usage: verify-bootstrap-online <full-sha>");
  assert.match(args[0], /^[a-f0-9]{40}$/, "bootstrap verification requires a full SHA");
  return { expectedBuildId: args[0], origin: productionOrigin };
}

export function verifyBootstrapTarget(target, expectedBuildId, channel) {
  assert.equal(target.channel, channel, "server must confirm the selected channel");
  assert.equal(target.target, expectedBuildId, "both initial channels must target the sealed bootstrap build");
  assert.equal(target.revision, 1, "bootstrap pointers must still have their initial revision");
  assert.equal(target.contract, contract);
  assert.equal(target.backend, expectedBuildId, "bootstrap readback must come from the deployed bootstrap backend");
  // Deliberately exclude selection intents, Cookies and arbitrary response fields.
  return { channel, target: target.target, revision: target.revision, backend: target.backend, contract };
}

// A CONNECT tunnel transports the browser's original TLS bytes. It neither
// decrypts nor records traffic. Closing it also disconnects WebKit SW requests,
// which do not consistently obey Playwright's context.setOffline flag.
// Only tests inject an alternate origin; the production CLI has no URL option.
export async function createNetworkGate(origin) {
  const target = new URL(origin);
  assert.equal(target.protocol, "https:");
  assert.equal(target.username + target.password, "");
  const authority = `${target.hostname}:${target.port || "443"}`;
  const sockets = new Set();
  let online = true;
  const server = createServer((_request, response) => { response.writeHead(405); response.end(); });
  server.on("connection", socket => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());
  });
  server.on("connect", (request, client, head) => {
    if (!online || request.url !== authority) { client.destroy(); return; }
    const upstream = connect({ host: target.hostname, port: Number(target.port || 443) });
    sockets.add(upstream);
    upstream.on("close", () => { sockets.delete(upstream); client.destroy(); });
    client.on("close", () => upstream.destroy());
    upstream.on("error", () => { upstream.destroy(); client.destroy(); });
    upstream.once("connect", () => {
      if (!online) { upstream.destroy(); return; }
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      client.pipe(upstream); upstream.pipe(client);
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    server: `http://127.0.0.1:${server.address().port}`,
    disconnect() { online = false; for (const socket of sockets) socket.destroy(); },
    async close() {
      online = false;
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}

async function assertPageBuild(page, expectedBuildId) {
  await page.getByRole("heading", { name: "关于合谱", exact: true }).waitFor();
  assert.equal(await page.locator('meta[name="same-page-build-id"]').getAttribute("content"), expectedBuildId);
  assert.equal(await page.locator("html").getAttribute("data-build-id"), expectedBuildId);
  await page.getByRole("group", { name: "更新通道", exact: true }).waitFor();
}

async function assertControlled(page, expectedBuildId) {
  await page.waitForFunction(() => navigator.serviceWorker.controller?.state === "activated");
  const identity = await page.evaluate(async () => {
    const controller = navigator.serviceWorker.controller;
    const result = await new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => { channel.port1.close(); reject(new Error("shell_identity_timeout")); }, 1500);
      channel.port1.onmessage = event => { clearTimeout(timer); channel.port1.close(); resolve(event.data); };
      controller.postMessage({ type: "SAME_PAGE_SHELL_IDENTITY" }, [channel.port2]);
    });
    return { buildId: result?.buildId, state: controller.state, scriptPath: new URL(controller.scriptURL).pathname };
  });
  assert.equal(identity.buildId, expectedBuildId, "the expected SW must control this document");
  assert.equal(identity.scriptPath, "/sw.js");
  return { buildId: identity.buildId, state: identity.state };
}

async function readTarget(page, expectedBuildId, channel) {
  const result = await page.evaluate(async () => {
    const response = await fetch("/api/client-release", { credentials: "same-origin", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8000) });
    return { status: response.status, cacheControl: response.headers.get("cache-control"), target: await response.json() };
  });
  assert.equal(result.status, 200);
  assert.match(result.cacheControl ?? "", /no-store/);
  return verifyBootstrapTarget(result.target, expectedBuildId, channel);
}

async function waitForSelection(page, channel) {
  await page.waitForFunction(channel => {
    const buttons = [...document.querySelectorAll('.release-channel-options button')];
    const chosen = buttons.find(button => button.textContent.includes(channel === "beta" ? "测试版" : "稳定版"));
    return chosen?.getAttribute("aria-pressed") === "true" && !chosen.disabled;
  }, channel);
}

export async function verifyBootstrapOnline({ expectedBuildId, origin = productionOrigin }) {
  assert.match(expectedBuildId, /^[a-f0-9]{40}$/);
  const { chromium, webkit } = await import("@playwright/test");
  const temporary = await mkdtemp(path.join(os.tmpdir(), "same-page-bootstrap-online-"));
  const results = [];
  try {
    for (const [name, engine] of [["chromium", chromium], ["webkit", webkit]]) {
      const profile = path.join(temporary, name);
      const gate = await createNetworkGate(origin);
      let context;
      try {
        const options = { headless: true, locale: "zh-CN", serviceWorkers: "allow", reducedMotion: "reduce", proxy: { server: gate.server } };
        context = await engine.launchPersistentContext(profile, options);
        let page = context.pages()[0] ?? await context.newPage();
        await page.goto(origin + "/about", { waitUntil: "domcontentloaded" });
        await assertPageBuild(page, expectedBuildId);
        const freshStable = await readTarget(page, expectedBuildId, "stable");
        // Ready/active is not the same as this page being controlled. This SW
        // intentionally does not claim clients, so navigate after activation.
        await page.evaluate(async () => {
          let timer;
          try {
            await Promise.race([
              navigator.serviceWorker.ready.then(registration => new Promise((resolve, reject) => {
                const active = registration.active;
                if (!active) { reject(new Error("active_worker_missing")); return; }
                const changed = () => {
                  if (active.state === "activated") { active.removeEventListener("statechange", changed); resolve(); }
                };
                active.addEventListener("statechange", changed); changed();
              })),
              new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("service_worker_activation_timeout")), 30_000); }),
            ]);
          } finally { clearTimeout(timer); }
        });
        await page.reload({ waitUntil: "domcontentloaded" });
        await assertPageBuild(page, expectedBuildId);
        const controller = await assertControlled(page, expectedBuildId);
        await waitForSelection(page, "stable");
        await page.getByRole("button", { name: /测试版.*提前体验/ }).click();
        await waitForSelection(page, "beta");
        const beta = await readTarget(page, expectedBuildId, "beta");
        await assertPageBuild(page, expectedBuildId);
        await page.getByRole("button", { name: /稳定版.*日常推荐/ }).click();
        await waitForSelection(page, "stable");
        const stable = await readTarget(page, expectedBuildId, "stable");
        await assertControlled(page, expectedBuildId);
        const version = context.browser()?.version() ?? null;

        // Disconnect before closing: no shutdown/update request can refill a
        // missing shell. Reopen the same on-disk profile with the gate closed.
        gate.disconnect();
        await context.close(); context = undefined;
        context = await engine.launchPersistentContext(profile, options);
        if (name === "chromium") await context.setOffline(true);
        page = context.pages()[0] ?? await context.newPage();
        await page.goto(origin + "/about", { waitUntil: "domcontentloaded" });
        await assertPageBuild(page, expectedBuildId);
        const offlineController = await assertControlled(page, expectedBuildId);
        assert.equal(await page.evaluate(async () => {
          try { await fetch("/api/client-release", { cache: "no-store", signal: AbortSignal.timeout(2000) }); return false; }
          catch { return true; }
        }), true, "offline verification must have no network access");
        results.push({ browser: name, version, freshStable, beta, stable, controller, offline: { browserRestart: true, networkDisconnected: true, sameBuild: true, controller: offlineController } });
        process.stdout.write(`Verified bootstrap channel round trip and offline restart in ${name}\n`);
      } finally {
        try { await context?.close(); } finally { await gate.close(); }
      }
    }
    return { expectedBuildId, initialRevision: 1, physicalDeviceAcceptance: false, browsers: results };
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = bootstrapArguments(process.argv.slice(2));
  // Remove an earlier success before starting a new attempt.
  await rm(evidencePath, { force: true });
  const evidence = await verifyBootstrapOnline(args);
  await mkdir(path.dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
}
