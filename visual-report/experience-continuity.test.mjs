import { mkdir } from "node:fs/promises";
import { test } from "node:test";
import { chromium, webkit, expect } from "@playwright/test";
import { startVisualServer } from "./setup.mjs";
import { createVisualFixtureSession } from "./fixtures.mjs";
import { withBrowserEvidence } from "../browser-tests/browser-evidence.mjs";

for (const [name, engine] of [["chromium", chromium], ["webkit", webkit]]) {
  test(`${name}: a temporary disconnect retains display-name input and expanded attachments`, async t => {
    const app = await startVisualServer({ script: "dev" });
    const browser = await engine.launch();
    const context = await browser.newContext({ viewport: { width: 834, height: 900 }, locale: "zh-CN", serviceWorkers: "block" });
    t.after(async () => { try { await context.close(); } finally { try { await browser.close(); } finally { await app.stop(); } } });
    const evidence = `artifacts/verification/issue-397/${name}`;
    await mkdir(evidence, { recursive: true });
    await withBrowserEvidence(context, evidence, async () => {
      const fixture = createVisualFixtureSession();
      let metadataReads = 0, holdMetadata = false, releaseMetadata;
      const metadata = new Promise(resolve => { releaseMetadata = resolve; });
      t.after(() => releaseMetadata());
      await context.route("**/api/**", async route => {
        const request = route.request(), pathname = new URL(request.url()).pathname;
        if (pathname.endsWith("/attachments")) {
          metadataReads++;
          if (holdMetadata) await metadata;
          return route.fulfill({ json: { attachments: [{ id: "rehearsal-notes", scoreId: "visual-score", name: "排练说明.md", kind: "markdown", url: null, sizeBytes: 40, revision: 1, updatedAt: 1, trashExpiresAt: null }] } });
        }
        if (pathname.endsWith("/settings")) return route.fulfill({ json: { name: "示例云盘", nameRevision: 0, displayName: "小林", membershipRevision: 0, canEditDriveInfo: true } });
        const result = fixture.resolve({ pathname, method: request.method(), identity: "admin", cookie: request.headers().cookie ?? "" });
        if (pathname.endsWith("/bootstrap")) {
          const data = JSON.parse(result.body);
          data.scores.find(score => score.id === "visual-score").attachmentCount = 1;
          result.body = JSON.stringify(data);
        }
        return route.fulfill(result);
      });
      const page = await context.newPage();
      await page.goto(`${app.origin}/choirs/visual-choir`);
      const disclosure = page.getByRole("button", { name: /排练示例 · 秋日合唱：1 个附件/ });
      await disclosure.click();
      const attachment = page.getByRole("button", { name: "排练说明.md", exact: true });
      await expect(attachment).toBeVisible();
      await attachment.evaluate(element => { element.dataset.continuityObserved = "true"; });
      await page.getByRole("button", { name: "我在此云盘", exact: true }).click();
      await page.getByRole("menuitem", { name: "云盘内显示名", exact: true }).click();
      const input = page.getByRole("textbox", { name: "我在此云盘的显示名", exact: true });
      await input.fill("尚未保存的排练名字");
      await input.evaluate(element => { element.dataset.continuityObserved = "true"; });
      await context.setOffline(true);
      await page.evaluate(() => window.dispatchEvent(new Event("offline")));
      await expect(page.getByRole("button", { name: "保存", exact: true })).toBeDisabled();
      await expect(input).toHaveValue("尚未保存的排练名字");
      await expect(input).toHaveAttribute("data-continuity-observed", "true");
      await page.screenshot({ path: `${evidence}/paused-display-name.png` });
      await page.getByRole("dialog").locator(".dialog-actions").getByRole("button", { name: "取消", exact: true }).click();
      await expect(disclosure).toHaveAttribute("aria-expanded", "true");
      await expect(attachment).toHaveAttribute("data-continuity-observed", "true");
      await expect(attachment).toBeDisabled();
      await expect(page.getByRole("button", { name: "我在此云盘", exact: true }).locator(".lucide-user-round")).toBeVisible();
      await page.screenshot({ path: `${evidence}/offline-attachments.png` });
      holdMetadata = true;
      await context.setOffline(false);
      await page.evaluate(() => window.dispatchEvent(new Event("online")));
      await expect.poll(() => metadataReads).toBeGreaterThanOrEqual(2);
      await expect(attachment).toBeVisible();
      await expect(attachment).toHaveAttribute("data-continuity-observed", "true");
      releaseMetadata();
      await expect(attachment).toBeEnabled();
    });
  });
}
