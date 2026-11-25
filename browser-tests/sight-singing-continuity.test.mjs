import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, expect } from "@playwright/test";
import { startStorageFixture } from "./storage-fixture.mjs";
import { practiceWave } from "../visual-report/practice-fixture.mjs";

const xml = `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Alto</part-name></score-part></part-list>
  <part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time>
  <clef><sign>G</sign><line>2</line></clef></attributes><note><pitch><step>A</step><octave>3</octave></pitch>
  <duration>4</duration><type>whole</type></note></measure></part></score-partwise>`;
const title = "弱网回归练习";
const noConnection = "暂时无法连接，已保存的内容仍然保留。";

test("a loaded sight-singing question survives offline and a failed identity refresh", { timeout: 90_000 }, async t => {
  const fixture = await startStorageFixture({ authenticated: true, previewEntry: false });
  let browser;
  t.after(async () => { try { await browser?.close(); } finally { await fixture.stop(); } });
  const directory = await mkdtemp(join(tmpdir(), "sight-singing-continuity-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const tone = join(directory, "sight-singing-a3.wav");
  await writeFile(tone, practiceWave());
  browser = await chromium.launch({ args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-audio-capture=${tone}`] });
  const context = await browser.newContext({ locale: "zh-CN", viewport: { width: 1024, height: 768 }, serviceWorkers: "allow" });
  const owner = fixture.accounts[0];
  const drive = `${fixture.origin}/choirs/${fixture.choirId}`;
  const questions = `${fixture.origin}/api/choirs/${fixture.choirId}/sight-singing/questions`;
  const question = `${questions}/${crypto.randomUUID()}`;
  assert.equal((await context.request.post(`${fixture.origin}/api/auth/sign-in/email`, {
    headers: { origin: fixture.origin }, data: { email: owner.email, password: owner.password },
  })).status(), 200);
  const seed = await context.request.put(question, {
    headers: { "x-same-page-owner-user-id": owner.id },
    multipart: {
      fields: JSON.stringify({ title, first: 0, last: 0, expectedVersion: null }),
      file: { name: "challenge.musicxml", mimeType: "application/vnd.recordare.musicxml+xml", buffer: Buffer.from(xml) },
    },
  });
  assert.equal(seed.status(), 200, await seed.text());

  const page = await context.newPage();
  await page.goto(drive);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  // An installed shell may leave its first tab uncontrolled until navigation.
  // Exercise a running shell whose precached worklet and soundfont can be read.
  await page.reload();
  assert.equal(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)), true);
  await page.getByRole("button", { name: "我的", exact: true }).click();
  await page.getByRole("menuitem", { name: "视唱挑战", exact: true }).click();
  await page.getByRole("button", { name: new RegExp(title) }).click();
  const heading = page.getByRole("heading", { name: title, exact: true });
  await expect(heading).toBeVisible();
  const run = page.locator(".challenge-run");
  await expect(run).toHaveAttribute("data-phase", "idle");

  let publications = 0;
  page.on("request", request => {
    if (request.url() === `${question}/results` && request.method() === "POST") publications++;
  });
  await page.getByRole("button", { name: "开始唱", exact: true }).click();
  await expect(run).toHaveAttribute("data-phase", "count");
  await context.setOffline(true);
  await expect(heading).toBeVisible();
  await expect(run).toHaveAttribute("data-phase", "result", { timeout: 12_000 });
  await expect(page.getByRole("alert").filter({ hasText: "成绩保存或发布失败。" })).toBeVisible();
  await expect(page.locator(".challenge-replay-controls audio")).toHaveAttribute("src", /^blob:/);
  await page.getByRole("button", { name: "回听演唱与钢琴答案", exact: true }).click();
  await expect(run).toHaveAttribute("data-replaying", "true");
  assert.equal(publications, 0);

  let sessionDown = true;
  await page.route("**/api/auth/get-session*", route => sessionDown
    ? route.fulfill({ status: 503, json: { message: "unavailable" } }) : route.continue());
  const failedSession = page.waitForResponse(response => response.url().includes("/api/auth/get-session") && response.status() === 503);
  await context.setOffline(false);
  await failedSession;
  await expect(run).toHaveAttribute("data-phase", "result");
  await page.getByRole("button", { name: "再试一次", exact: true }).click();
  await expect(run).toHaveAttribute("data-phase", "idle");
  await page.getByRole("button", { name: "编辑题目", exact: true }).click();
  const name = page.locator("input[name='title']");
  await name.fill("保留未发布的题目名称");
  const publish = page.getByRole("button", { name: "更新云盘题目", exact: true });
  await expect(publish).toBeDisabled();
  await expect(page.getByRole("status").filter({ hasText: noConnection })).toBeVisible();
  // Hold the recovery read, then deliver a definitive denial to that same
  // request. A focus event could legally coalesce with a read already running.
  const revalidation = Promise.withResolvers();
  await page.route(questions, async route => {
    await revalidation.promise;
    await route.fulfill({ status: 403, json: { error: "permission_denied" } });
  });
  t.after(() => revalidation.resolve());
  sessionDown = false;
  await page.getByRole("button", { name: "重试连接", exact: true }).click();
  await expect(publish).toBeEnabled({ timeout: 12_000 });
  await expect(name).toHaveValue("保留未发布的题目名称");
  assert.equal(publications, 0);

  revalidation.resolve();
  await expect(page.getByText("视唱挑战仅对当前云盘成员开放。", { exact: true })).toBeVisible();
  await expect(name).toHaveCount(0);
  await page.unroute(questions);

  // A fresh page with the same locally remembered owner cannot read the last
  // question or infer membership without a successful remote response.
  await context.setOffline(true);
  const cold = await context.newPage();
  await cold.goto(`${drive}/sight-singing`);
  await expect(cold.getByRole("status").filter({ hasText: noConnection })).toBeVisible();
  await expect(cold.getByRole("button", { name: new RegExp(title) })).toHaveCount(0);

  const coldRead = Promise.withResolvers();
  t.after(() => coldRead.resolve());
  await cold.route(questions, async route => {
    await coldRead.promise;
    await route.fulfill({ status: 503, json: { error: "unavailable" } });
  });
  const read = cold.waitForRequest(questions);
  await context.setOffline(false);
  await read;
  await expect(cold.getByText("正在读取…", { exact: true })).toBeVisible();
  await expect(cold.getByText("这个云盘还没有已发布的题目。")).toHaveCount(0);
  coldRead.resolve();
  const unavailable = cold.getByRole("status").filter({ hasText: "无法加载云盘题目。" });
  await expect(unavailable).toBeVisible();
  await cold.unroute(questions);
  await unavailable.getByRole("button", { name: "重新加载", exact: true }).click();
  await expect(cold.getByRole("button", { name: new RegExp(title) })).toBeVisible();

  // Result publication has the same membership requirement as the GETs. A
  // denial received from the write also closes a previously authorized view.
  await cold.route(`${question}/results`, route => route.request().method() === "POST"
    ? route.fulfill({ status: 403, json: { error: "permission_denied" } }) : route.continue());
  await cold.getByRole("button", { name: new RegExp(title) }).click();
  await cold.getByRole("button", { name: "开始唱", exact: true }).click();
  await expect(cold.getByText("视唱挑战仅对当前云盘成员开放。", { exact: true })).toBeVisible({ timeout: 12_000 });
  await expect(cold.locator(".challenge-run")).toHaveCount(0);
});
