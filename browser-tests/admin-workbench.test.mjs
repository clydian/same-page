import { changeNotationSize } from "./practice-controls.mjs";
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
      const visitor = await browser.newContext({ serviceWorkers: "block" });
      const entry = await visitor.newPage();
      await entry.goto(f.origin + "/admin");
      await expect(entry.getByRole("heading", { name: "登录产品后台" })).toBeVisible();
      await expect(entry.getByRole("link", { name: "登录", exact: true })).toHaveAttribute("href", "/login?returnTo=%2Fadmin");
      await visitor.close();
      await page.goto(f.origin + "/user");
      await expect(page.getByRole("heading", { name: "账户", exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: /产品后台/ })).toHaveCount(0);
      await page.goto(f.origin + "/admin");
      await expect(
        page.getByRole("link", { name: "打开", exact: true }),
      ).toHaveCount(2);
      await mkdir("artifacts/verification/admin", { recursive: true });
      await page.screenshot({ path: `artifacts/verification/admin/${engine}-directory.png`, fullPage: true });
      await page
        .getByLabel("云盘", { exact: true })
        .selectOption(f.adminDriveId);
      await expect(
        page.getByRole("link", { name: "打开", exact: true }),
      ).toHaveCount(1);
      await expect(
        page.getByRole("cell", { name: /另一份原谱\.pdf/ }),
      ).toBeVisible();
      await page.getByRole("link", { name: "打开", exact: true }).click();
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
      const imported = await page.getByLabel("比较结果", { exact: true }).inputValue();
      await page.getByLabel("比较结果", { exact: true }).selectOption("");
      await expect(page.getByText("先导入 XML，再对照检查和试听。", { exact: true })).toBeVisible();
      await expect(page.getByLabel("比较结果", { exact: true })).toHaveValue("");
      await page.getByRole("button", { name: "刷新", exact: true }).click();
      await expect(page.getByText("先导入 XML，再对照检查和试听。", { exact: true })).toBeVisible();
      await page.getByLabel("比较结果", { exact: true }).selectOption(imported);
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
      const notationSize = page.getByRole("button", { name: "谱面大小", exact: true });
      await expect(notationSize).toHaveText("60%");
      await page.locator(".admin-musicxml .practice-notation-scroll").dispatchEvent("wheel", { ctrlKey: true, deltaY: -80 });
      await expect(notationSize).toHaveText("60%");
      await expect.poll(() => page.locator(".admin-musicxml .practice-notation-paper").evaluate(element => new DOMMatrixReadOnly(getComputedStyle(element).transform).a)).toBeGreaterThan(1);
      await page.getByRole("button", { name: "恢复查看比例", exact: true }).click();
      await changeNotationSize(page, "放大谱面");
      await expect(notationSize).toHaveText("70%");
      await changeNotationSize(page, "恢复默认谱面大小");
      await expect(notationSize).toHaveText("60%");
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
      await expect(page.getByRole("checkbox")).toHaveCount(0);
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

      // Publishing saves the latest optional note without a separate approval step.
      const publicationNote = engine === "chromium" ? "" : "检查完成，供后续备案";
      await page.getByLabel("检查备注", { exact: true }).fill(publicationNote);
      await expect(
        page.getByRole("button", { name: "发布练习版", exact: true }),
      ).toBeEnabled({ timeout: 60000 });
      await page
        .getByRole("button", { name: "发布练习版", exact: true })
        .click();
      await page.getByRole("button", { name: "确认发布", exact: true }).click();
      await expect(page.getByText(/发布成功，成员现在可以使用/)).toBeVisible();
      const reviewed = await (await context.request.get(`${f.origin}/api/admin/scores/${f.adminScoreId}`)).json();
      assert.equal(reviewed.candidates[0].reviewNote, publicationNote);
      assert.equal(reviewed.candidates[0].review, "approved");
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
