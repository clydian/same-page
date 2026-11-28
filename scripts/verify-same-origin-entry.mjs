import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { X509Certificate, createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { createServer as httpsServer, request as httpsRequest } from "node:https";
import { connect, createServer as tcpServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { startStorageFixture } from "../browser-tests/storage-fixture.mjs";
import { prepareSameOriginReleasePair } from "./same-origin-release-fixture.mjs";

const host = "app.same-page.test";
const originHost = "worker-origin.same-page.test";
const loopback = "127.0.0.1";
const listeners = [];
const traffic = [];
let browser, fixture, activeEntry, releases;

async function listen(server) {
  const sockets = new Set();
  server.on("connection", socket => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, loopback, resolve);
  });
  let stopping;
  const listener = {
    port: server.address().port,
    disconnect: () => { for (const socket of sockets) socket.destroy(); },
    stop: () => stopping ??= new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      listener.disconnect();
    }),
  };
  listeners.push(listener);
  return listener;
}

async function certificate(directory, id, name) {
  const key = join(directory, id + ".key");
  const cert = join(directory, id + ".pem");
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
    "-subj", "/CN=" + name, "-addext", "subjectAltName=DNS:" + name, "-keyout", key, "-out", cert], { stdio: "ignore" });
  return { key: await readFile(key), cert: await readFile(cert) };
}

function forward(connectUpstream, request, response, headers, onError = () => {}) {
  const upstream = connectUpstream({ method: request.method, path: request.url, headers }, result => {
    response.writeHead(result.statusCode, result.headers);
    result.on("error", () => response.destroy()).pipe(response);
  });
  upstream.on("error", error => {
    onError(error);
    if (!response.headersSent) response.writeHead(502, { "Cache-Control": "no-store" }).end();
    else response.destroy();
  });
  response.on("close", () => { if (!response.writableFinished) upstream.destroy(); });
  request.pipe(upstream);
}

const draft = (await build({
  stdin: {
    contents: [
      'import { saveAnnotationDraft } from "./src/client/annotations/annotation-state";',
      'import { localDatabase, annotationRecordKey } from "./src/client/platform/local-database";',
      'import { createLocalWorkspace, authenticatedLocalOwnerKey } from "./src/client/platform/local-workspace";',
      'export async function readDraft({ userId, choirId, scoreId, id, layerId, text }, seed) {',
      '  const workspace = createLocalWorkspace(authenticatedLocalOwnerKey(userId), choirId, scoreId);',
      '  if (seed) await saveAnnotationDraft(workspace, { id, layerId, payload: {',
      '    kind: "text", pageNumber: 1, x: .2, y: .3, fontScale: .024, text, textAlign: "center"',
      '  } });',
      '  return localDatabase.annotations.get(annotationRecordKey(workspace.scopeKey, id));',
      '}',
    ].join("\n"),
    resolveDir: process.cwd(),
  },
  bundle: true, format: "esm", platform: "browser", write: false,
  define: { "import.meta.env": JSON.stringify({ VITE_CONNECTIONS_ENABLED: "false" }) },
})).outputFiles[0].text;

const temporary = await mkdtemp(join(tmpdir(), "same-page-614-"));
try {
  releases = await prepareSameOriginReleasePair();
  const { stable: buildId, candidate } = releases;
  // Steer raw TCP so the browser owns its TLS connections, cookies and SW. A
  // switch drops existing connections, including ones otherwise reusable.
  const selector = await listen(tcpServer(socket => {
    if (!activeEntry) { socket.destroy(); return; }
    const upstream = connect(activeEntry.port, loopback);
    socket.on("error", () => upstream.destroy()).on("close", () => upstream.destroy());
    upstream.on("error", () => socket.destroy()).on("close", () => socket.destroy());
    socket.pipe(upstream).pipe(socket);
  }));
  const canonical = new URL("https://" + host + ":" + selector.port);
  fixture = await startStorageFixture({
    authenticated: true, previewEntry: false, productAdmin: true,
    authOrigin: canonical.origin, seedFrontendReleases: releases.seed,
  });
  const local = new URL(fixture.origin);
  const originTLS = await certificate(temporary, "origin", originHost);
  const origin = await listen(httpsServer(originTLS, (request, response) => {
    if (request.socket.servername !== originHost || request.headers.host !== canonical.host) {
      response.writeHead(421).end(); return;
    }
    if (request.url === "/__local-draft-probe.mjs") {
      response.writeHead(200, { "Content-Type": "text/javascript", "Cache-Control": "no-store" }).end(draft);
      return;
    }
    forward((options, receive) => httpRequest({ ...options, hostname: local.hostname, port: local.port }, receive),
      request, response, { ...request.headers, host: local.host });
  }));
  const [directTLS, backupTLS] = await Promise.all(["direct", "backup"].map(entry => certificate(temporary, entry, host)));
  let backupSNI = originHost, upstreamError;
  const edge = (entry, tls) => listen(httpsServer(tls, (request, response) => {
    const path = new URL(request.url, canonical).pathname;
    traffic.push({ entry, path, destination: request.headers["sec-fetch-dest"] });
    response.setHeader("X-Fixture-Entry", entry);
    forward((options, receive) => httpsRequest({
      ...options, hostname: loopback, port: origin.port, ca: originTLS.cert,
      servername: entry === "backup" ? backupSNI : originHost, agent: false,
    }, receive), request, response, request.headers, error => { upstreamError = error.code; });
  }));
  const direct = await edge("direct", directTLS);
  const backup = await edge("backup", backupTLS);
  const pins = [directTLS, backupTLS].map(({ cert }) => createHash("sha256")
    .update(new X509Certificate(cert).publicKey.export({ type: "spki", format: "der" })).digest("base64"));
  browser = await chromium.launch({
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
    args: ["--no-proxy-server", "--host-resolver-rules=MAP " + host + " " + loopback + ", MAP * ~NOTFOUND",
      "--ignore-certificate-errors-spki-list=" + pins.join(",")],
  });
  const switchTo = entry => { activeEntry = entry; selector.disconnect(); };
  function assertStatus(response, status, entry) {
    assert.equal(response.status(), status);
    assert.equal(response.headers()["x-fixture-entry"], entry);
  }
  const selected = async page => page.evaluate(async () => {
    const response = await fetch("/api/client-release", { cache: "no-store" });
    return { status: response.status, entry: response.headers.get("X-Fixture-Entry"),
      cache: response.headers.get("Cache-Control"), ...(await response.json()) };
  });
  const session = page => page.evaluate(async () => {
    const response = await fetch("/api/auth/get-session", { cache: "no-store" });
    return { entry: response.headers.get("X-Fixture-Entry"), data: await response.json() };
  });
  const workerRequest = entry => traffic.some(item => item.entry === entry && item.path === "/sw.js" && item.destination === "serviceworker");
  const open = (page, path) => page.goto(new URL(path, canonical).href, { waitUntil: "domcontentloaded", timeout: 20_000 });
  const workerBuild = (page, slot) => page.evaluate(async slot => {
    const worker = (await navigator.serviceWorker.getRegistration())?.[slot];
    if (!worker) return null;
    return new Promise(resolve => {
      const channel = new MessageChannel();
      const finish = id => { clearTimeout(timer); channel.port1.close(); resolve(id); };
      const timer = setTimeout(() => finish(null), 1000);
      channel.port1.onmessage = event => finish(event.data?.buildId ?? null);
      worker.postMessage({ type: "SAME_PAGE_SHELL_IDENTITY" }, [channel.port2]);
    });
  }, slot);

  switchTo(direct);
  const context = await browser.newContext({ locale: "zh-CN" });
  const page = await context.newPage();
  const drivePath = "/choirs/" + fixture.choirId;
  assertStatus(await open(page, "/login?returnTo=" + encodeURIComponent(drivePath)), 200, "direct");
  const account = fixture.accounts[0];
  await page.getByLabel("邮箱", { exact: true }).fill(account.email);
  await page.getByRole("button", { name: "继续", exact: true }).click();
  await page.getByLabel("密码", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.locator(".file-row__open").first()).toBeVisible();
  await page.waitForFunction(async () => (await navigator.serviceWorker.getRegistration())?.active?.state === "activated");
  const initialSession = await session(page);
  assert.ok(initialSession.data?.session?.id && initialSession.data?.user?.id === account.id);
  const readCookie = async name => (await context.cookies(canonical.origin)).find(cookie => name(cookie.name));
  const authCookie = await readCookie(name => name.includes("session_token"));
  assert.ok(authCookie?.httpOnly && authCookie.secure && authCookie.domain === host);
  assert.equal((await selected(page)).channel, "stable");
  // The default channel has no cookie. Use the real selection API to keep an
  // explicit stable cookie before and after the same-channel version update.
  assert.equal(await page.evaluate(async intent => (await fetch("/api/client-release", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ channel: "stable", intent }),
  })).status, randomUUID()), 204);
  const preference = await selected(page);
  assert.equal(preference.channel, "stable");
  assert.equal(preference.target, buildId);
  await expect.poll(() => workerBuild(page, "active")).toBe(buildId);
  const channelCookie = await readCookie(name => name === "same-page-channel");
  assert.ok(channelCookie?.httpOnly && channelCookie.secure && channelCookie.domain === host);
  const score = "/api/choirs/" + fixture.choirId + "/scores/" + fixture.scoreId;
  const layerId = await page.evaluate(async score =>
    (await (await fetch(score + "/layers")).json()).layers.find(layer => layer.kind === "personal").id, score);
  const randomId = randomUUID();
  const readDraft = seed => page.evaluate(async ({ input, seed }) => {
    const { readDraft } = await import("/__local-draft-probe.mjs");
    return readDraft(input, seed);
  }, { input: { userId: account.id, choirId: fixture.choirId, scoreId: fixture.scoreId, id: randomId,
    layerId, text: "合谱 #614 本地草稿" }, seed });
  const before = await readDraft(true);
  assert.equal(before?.state, "draft");
  assert.ok(workerRequest("direct"), "Chromium must have fetched the SW from primary");

  // Stop the actual primary TLS listener. A profile without a shell genuinely
  // fails before steering. It must then get HTML and SW through the backup.
  await direct.stop();
  selector.disconnect();
  const cold = await browser.newContext({ locale: "zh-CN" });
  const failed = await cold.newPage();
  await assert.rejects(open(failed, "/drives"), /net::ERR_/);
  await failed.close();
  switchTo(backup);
  const fresh = await cold.newPage();
  assertStatus(await open(fresh, "/drives"), 200, "backup");
  const displayedBuild = currentPage => currentPage.locator('meta[name="same-page-build-id"]').getAttribute("content");
  assert.equal(await displayedBuild(fresh), buildId);
  await fresh.waitForFunction(async () => (await navigator.serviceWorker.getRegistration())?.active?.state === "activated");
  assert.ok(workerRequest("backup"), "cold Chromium must have fetched the SW from backup");
  const coldChoice = await selected(fresh);
  assert.equal(coldChoice.entry, "backup");
  assert.equal(coldChoice.channel, "stable");
  await cold.close();

  const verifyWarm = async (entry, expected) => {
    traffic.length = 0;
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    assert.ok(workerRequest(entry), "browser-managed SW request must use the selected entry");
    await open(page, drivePath);
    await expect(page.locator(".file-row__open").first()).toBeVisible();
    assert.equal(await displayedBuild(page), expected.target);
    const readback = await selected(page);
    assert.equal(readback.status, 200);
    assert.equal(readback.entry, entry);
    assert.match(readback.cache, /no-store/);
    for (const key of ["channel", "intent", "target", "revision"]) assert.equal(readback[key], expected[key]);
    const current = await session(page);
    assert.equal(current.entry, entry);
    assert.ok(current.data?.session?.id === initialSession.data.session.id && current.data?.user?.id === account.id);
    assert.ok((await readCookie(name => name === authCookie.name))?.value === authCookie.value);
    assert.ok((await readCookie(name => name === channelCookie.name))?.value === channelCookie.value);
    assert.deepEqual(await readDraft(false), before);
    assert.equal(new URL(page.url()).origin, canonical.origin);
    const scopes = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map(registration =>
      [registration.scope, registration.active?.scriptURL]));
    assert.deepEqual(scopes, [[canonical.href, new URL("/sw.js", canonical).href]]);
  };
  await verifyWarm("backup", preference);

  // Keep an actual reader open to veto a waiting worker. The main listener is
  // still stopped. A different browser profile publishes B to the same stable
  // channel through the local Workerd promotion API, using a synthetic admin.
  const reader = await context.newPage();
  await open(reader, drivePath + "/scores/" + fixture.scoreId);
  await expect(reader.locator("canvas[data-pdf-canvas-active]").first()).toBeVisible();
  const adminContext = await browser.newContext({ locale: "zh-CN" });
  const adminPage = await adminContext.newPage();
  await open(adminPage, "/login");
  const admin = fixture.accounts[1];
  assert.equal(await adminPage.evaluate(async ({ email, password }) => (await fetch("/api/auth/sign-in/email", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }),
  })).status, { email: admin.email, password: admin.password }), 200);
  await open(page, "/about");
  await page.bringToFront();
  const check = page.getByRole("button", { name: /^(重试)?检查更新$/ });
  await expect(check).toBeEnabled();
  traffic.length = 0;
  const promote = await adminPage.evaluate(async input => {
    const response = await fetch("/api/admin/releases/promote", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
    });
    return { status: response.status, entry: response.headers.get("X-Fixture-Entry") };
  }, { id: randomUUID(), expectedBeta: candidate, expectedRevision: preference.revision });
  assert.deepEqual(promote, { status: 204, entry: "backup" });
  await check.click();
  await expect.poll(() => workerBuild(page, "waiting"), { timeout: 30_000 }).toBe(candidate);
  assert.ok(workerRequest("backup"));
  assert.ok(traffic.some(item => item.entry === "backup" && item.path.startsWith("/_releases/" + candidate + "/")));
  const apply = page.getByRole("button", { name: "重新加载并更新", exact: true });
  await apply.click();
  await expect(page.getByRole("region", { name: "应用版本" }).getByRole("status"))
    .toHaveText("请先在其他合谱窗口完成操作并返回文件库，或关闭那些窗口，再重试");
  assert.equal(await displayedBuild(page), buildId);
  assert.equal(await displayedBuild(reader), buildId);
  await reader.close();
  await apply.click();
  await expect.poll(() => displayedBuild(page), { timeout: 30_000 }).toBe(candidate);
  await expect.poll(() => workerBuild(page, "active")).toBe(candidate);
  assert.ok(traffic.every(item => item.entry === "backup"), "primary must stay down until the new build is active");
  await adminContext.close();
  const updatedPreference = { ...preference, target: candidate, revision: preference.revision + 1 };
  await verifyWarm("backup", updatedPreference);
  backupSNI = "wrong-origin.same-page.test";
  const invalid = await page.evaluate(async () => (await fetch("/api/client-release", { cache: "no-store" })).status);
  assert.equal(invalid, 502);
  assert.equal(upstreamError, "ERR_TLS_CERT_ALTNAME_INVALID");
  backupSNI = originHost;
  const restoredDirect = await edge("direct", directTLS);
  switchTo(restoredDirect);
  await verifyWarm("direct", updatedPreference);

  // The stable and beta targets now share B following local promotion. An
  // explicit beta selection must retain its cookie when switching entry.
  await open(page, "/about");
  const beta = page.getByRole("button", { name: /^测试版/ });
  await beta.click();
  await expect(beta).toHaveAttribute("aria-pressed", "true");
  const betaChoice = await selected(page);
  const betaCookie = await readCookie(name => name === "same-page-channel");
  assert.ok(betaCookie?.httpOnly && betaCookie.secure && betaCookie.value !== channelCookie.value);
  switchTo(backup);
  const betaReadback = await selected(page);
  assert.equal(betaReadback.entry, "backup");
  assert.equal(betaReadback.channel, "beta");
  for (const key of ["intent", "target", "revision"]) assert.equal(betaReadback[key], betaChoice[key]);
  assert.ok((await readCookie(name => name === "same-page-channel"))?.value === betaCookie.value);
  switchTo(restoredDirect);
  console.log("Chromium " + browser.version() + ": cold HTML/SW/permission, stable " + buildId.slice(0, 7) +
    " → " + candidate.slice(0, 7) + " on backup with reader veto, return to direct, session/channel/draft continuity, upstream TLS mismatch rejected");
} finally {
  try {
    await browser?.close();
    await Promise.all(listeners.map(listener => listener.stop()));
    await fixture?.stop();
  } finally {
    await releases?.restore();
    await rm(temporary, { recursive: true, force: true });
  }
}
