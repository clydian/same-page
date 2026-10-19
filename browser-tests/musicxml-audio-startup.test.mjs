import assert from "node:assert/strict";
import test from "node:test";
import { chromium, webkit, expect } from "@playwright/test";
import { startStorageFixture } from "./storage-fixture.mjs";
import { musicXmlFixture } from "./musicxml-fixture.mjs";

for (const [engine, type] of [["chromium", chromium], ["webkit", webkit]]) {
  test(`MusicXML cancels pending audio startup without late sound (${engine})`, { timeout: 180000 }, async t => {
    const fixture = await startStorageFixture({ authenticated: true, previewEntry: false });
    let browser;
    t.after(async () => { try { await browser?.close(); } finally { await fixture.stop(); } });
    browser = await type.launch();
    const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, serviceWorkers: "block" });
    const login = await context.request.post(`${fixture.origin}/api/auth/sign-in/email`, {
      headers: { origin: fixture.origin }, data: { email: fixture.accounts[0].email, password: fixture.accounts[0].password },
    });
    assert.equal(login.status(), 200);
    const bytes = Buffer.from(musicXmlFixture());
    const uploaded = await context.request.post(`${fixture.origin}/api/choirs/${fixture.choirId}/scores/${fixture.scoreId}/attachments/${crypto.randomUUID()}/file?${new URLSearchParams({ name: "初始化.musicxml", size: String(bytes.length) })}`, {
      headers: { "content-type": "application/vnd.recordare.musicxml+xml" }, data: bytes,
    });
    assert.equal(uploaded.status(), 201);
    await context.addInitScript(() => {
      // Hold completion of the real module load, rather than sleeping or
      // changing the library. Every browser exercises the initialization window.
      const state = window.__audioStartup = { pending: [], nodes: 0, stopped: 0, analysers: [] };
      const addModule = AudioWorklet.prototype.addModule;
      AudioWorklet.prototype.addModule = function (...args) {
        return addModule.apply(this, args).then(() => new Promise(resolve => state.pending.push(resolve)));
      };
      const WorkletNode = AudioWorkletNode;
      window.AudioWorkletNode = class extends WorkletNode {
        constructor(...args) { super(...args); state.nodes++; }
      };
      const stop = AudioBufferSourceNode.prototype.stop;
      AudioBufferSourceNode.prototype.stop = function (...args) {
        state.stopped++;
        return stop.apply(this, args);
      };
      const connect = AudioNode.prototype.connect;
      AudioNode.prototype.connect = function (destination, ...args) {
        if (destination instanceof AudioDestinationNode) {
          const analyser = this.context.createAnalyser();
          state.analysers.push(analyser);
          connect.call(this, analyser);
          connect.call(analyser, destination);
          return destination;
        }
        return connect.call(this, destination, ...args);
      };
    });

    for (const action of ["pause", "end", "back"]) {
      await t.test(action, async () => {
        const page = await context.newPage(), errors = [];
        page.on("pageerror", error => errors.push(error.message));
        try {
          const library = `${fixture.origin}/choirs/${fixture.choirId}`;
          await page.goto(library);
          await page.getByRole("button", { name: "本地链路测试：1 个附件", exact: true }).click();
          await page.getByRole("button", { name: "初始化.musicxml", exact: true }).click();
          const player = page.getByTestId("musicxml-player");
          await expect(player.getByRole("button", { name: "播放", exact: true })).toBeEnabled({ timeout: 60000 });
          await player.getByRole("button", { name: "播放", exact: true }).click();
          await expect(player.getByRole("button", { name: "暂停", exact: true })).toBeVisible();
          await expect.poll(() => page.evaluate(() => window.__audioStartup.pending.length)).toBe(1);
          assert.equal(await page.evaluate(() => window.__audioStartup.nodes), 0);

          if (action === "pause") {
            await player.getByRole("button", { name: "暂停", exact: true }).click();
            await expect(player.getByRole("button", { name: "播放", exact: true })).toBeEnabled();
          } else if (action === "end") {
            await page.getByRole("button", { name: "结束练习", exact: true }).click();
            await expect(player).toHaveCount(0);
          } else {
            await page.goBack();
            await expect(page).toHaveURL(library);
            await expect(player).toHaveCount(0);
          }
          await expect.poll(() => page.evaluate(() => window.__audioStartup.stopped)).toBe(1);
          await page.evaluate(async () => {
            window.__audioStartup.pending.shift()();
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          });
          assert.equal(await page.evaluate(() => window.__audioStartup.nodes), 0, "cancelled startup must not create or connect a worklet");
          assert.deepEqual(errors, [], "cancel and late completion must not throw");

          if (action === "pause") {
            await player.getByRole("button", { name: "播放", exact: true }).click();
            await expect.poll(() => page.evaluate(() => window.__audioStartup.pending.length)).toBe(1);
            await page.evaluate(() => window.__audioStartup.pending.shift()());
            await expect.poll(() => page.evaluate(() => window.__audioStartup.analysers.some(analyser => {
              const samples = new Float32Array(analyser.fftSize);
              analyser.getFloatTimeDomainData(samples);
              return samples.some(sample => Math.abs(sample) > 0.0001);
            })), { timeout: 10000 }).toBe(true);
            assert.equal(await page.evaluate(() => window.__audioStartup.nodes), 1);
            await player.getByRole("button", { name: "暂停", exact: true }).click();
            await page.getByRole("button", { name: "结束练习", exact: true }).click();
            await expect(player).toHaveCount(0);
            assert.deepEqual(errors, []);
          }
        } finally { await page.close(); }
      });
    }
    await context.close();
  });
}
