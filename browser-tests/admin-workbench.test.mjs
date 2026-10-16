import assert from "node:assert/strict";
import test from "node:test";
import { mkdir } from "node:fs/promises";
import { chromium, webkit, expect } from "@playwright/test";
import { startStorageFixture } from "./storage-fixture.mjs";
import { musicXmlFixture } from "./musicxml-fixture.mjs";
for (const [engine, type] of [
  ["chromium", chromium],
  ["webkit", webkit],
]) {
  test(
    `product admin imports, reviews and publishes across two drives (${engine})`,
    { timeout: 180000 },
    async (t) => {
      const f = await startStorageFixture({
        authenticated: true,
        nonMember: true,
        previewEntry: false,
        productAdmin: true,
      });
      let browser;
      t.after(async () => {
        try {
          await browser?.close();
        } finally {
          await f.stop();
        }
      });
      browser = await type.launch();
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
        serviceWorkers: "block",
      });
      const login = await context.request.post(
        f.origin + "/api/auth/sign-in/email",
        {
          headers: { origin: f.origin },
          data: {
            email: f.accounts[1].email,
            password: f.accounts[1].password,
          },
        },
      );
      assert.equal(login.status(), 200);
      assert.equal(
        (
          await context.request.get(
            `${f.origin}/api/choirs/${f.choirId}/scores`,
          )
        ).status(),
        403,
      );
      await context.addInitScript(() => {
        window.__adminAudio = [];
        const connect = AudioNode.prototype.connect;
        AudioNode.prototype.connect = function (destination, ...args) {
          if (destination instanceof AudioDestinationNode) {
            const analyser = this.context.createAnalyser();
            window.__adminAudio.push(analyser);
            connect.call(this, analyser);
            connect.call(analyser, destination);
            return destination;
          }
          return connect.call(this, destination, ...args);
        };
      });
      const page = await context.newPage(),
        errors = [];
      page.on("pageerror", (e) => errors.push(e.stack));
      await page.goto(f.origin + "/admin");
      await expect(
        page.getByRole("link", { name: "查看与检查 →" }),
      ).toHaveCount(2);
      await page
        .getByLabel("云盘", { exact: true })
        .selectOption(f.adminDriveId);
      await expect(
        page.getByRole("link", { name: "查看与检查 →" }),
      ).toHaveCount(1);
      await expect(
        page.getByRole("cell", { name: /另一份原谱\.pdf/ }),
      ).toBeVisible();
      await page.getByRole("link", { name: "查看与检查 →" }).click();
      await page.getByRole("button", { name: "导入 XML", exact: true }).click();
      await page.getByLabel("MusicXML 文件", { exact: true }).setInputFiles({
        name: "练习.musicxml",
        mimeType: "application/vnd.recordare.musicxml+xml",
        buffer: musicXmlFixture(),
      });
      await page
        .getByRole("button", { name: "导入并检查", exact: true })
        .click();
      await expect(
        page.getByRole("dialog", { name: "导入候选练习版" }),
      ).toHaveCount(0);
      const player = page.getByTestId("musicxml-player");
      await expect(
        player.getByRole("button", { name: "播放", exact: true }),
      ).toBeEnabled({ timeout: 60000 });
      await expect(
        page.locator(".admin-musicxml .at-surface svg").first(),
      ).toBeVisible();
      await expect(
        page.locator(".admin-comparison canvas").first(),
      ).toBeAttached({ timeout: 20000 });
      await player.getByRole("button", { name: "播放", exact: true }).click();
      await expect(
        player.getByRole("button", { name: "暂停", exact: true }),
      ).toBeVisible();
      await expect
        .poll(
          () =>
            page.evaluate(() =>
              window.__adminAudio.some((a) => {
                const samples = new Float32Array(a.fftSize);
                a.getFloatTimeDomainData(samples);
                return samples.some((v) => Math.abs(v) > 0.0001);
              }),
            ),
          { timeout: 10000 },
        )
        .toBe(true);
      await player.getByRole("button", { name: "暂停", exact: true }).click();
      await player
        .getByRole("button", { name: "练习设置", exact: true })
        .click();
      await expect(
        page.getByRole("dialog", { name: "练习设置", exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "独奏 Soprano", exact: true })
        .click();
      await page
        .getByRole("button", { name: "关闭练习设置", exact: true })
        .click();
      for (const label of [
        "声部、音高与节奏已核对",
        "调号、拍号与反复已核对",
        "关键片段已试听",
      ])
        await page.getByLabel(label, { exact: true }).check();
      await page.getByLabel("检查备注", { exact: true }).fill("两声部已核对");
      // Saving through the navigation guard must advance the local review CAS,
      // even if the subsequent import is cancelled.
      await page.getByRole("button", { name: "导入 XML", exact: true }).click();
      await expect(
        page.getByRole("dialog", { name: "处理未保存的修改" }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "保存并返回", exact: true })
        .click();
      await expect(
        page.getByRole("dialog", { name: "导入候选练习版" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "关闭", exact: true }).click();

      await page
        .getByRole("button", { name: "标记检查通过", exact: true })
        .click();
      await expect(page.getByText(/检查结论：已通过/)).toBeVisible();
      await expect(
        page.getByRole("button", { name: "发布练习版", exact: true }),
      ).toBeEnabled({ timeout: 60000 });
      await page
        .getByRole("button", { name: "发布练习版", exact: true })
        .click();
      await page.getByRole("button", { name: "确认发布", exact: true }).click();
      await expect(page.getByText(/发布成功，成员现在可以使用/)).toBeVisible();
      const member = await browser.newContext({ serviceWorkers: "block" });
      await member.request.post(f.origin + "/api/auth/sign-in/email", {
        headers: { origin: f.origin },
        data: { email: f.accounts[0].email, password: f.accounts[0].password },
      });
      const attachments = await (
        await member.request.get(
          `${f.origin}/api/choirs/${f.adminDriveId}/attachments?scoreIds=${f.adminScoreId}`,
          { headers: { "X-Same-Page-Attachments": "2" } },
        )
      ).json();
      assert.equal(attachments.attachments[0].source, "generated");
      assert.equal(
        (
          await member.request.get(
            `${f.origin}/api/admin/scores/${f.adminScoreId}`,
          )
        ).status(),
        403,
      );
      await mkdir("artifacts/verification/admin", { recursive: true });
      await page.locator(".admin-musicxml").scrollIntoViewIfNeeded();
      await expect
        .poll(() =>
          page.locator(".admin-musicxml .at-surface svg text").count(),
        )
        .toBeGreaterThan(10);
      await page.screenshot({
        path: `artifacts/verification/admin/${engine}.png`,
        fullPage: true,
      });
      assert.deepEqual(errors, []);
    },
  );
}
