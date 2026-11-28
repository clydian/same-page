import { before, after, test } from "node:test";
import { chromium, webkit, expect } from "@playwright/test";
import { startVisualServer } from "./setup.mjs";
import { createVisualFixtureSession } from "./fixtures.mjs";

let app;
before(async () => { app = await startVisualServer({ script: "dev" }); });
after(async () => { await app?.stop(); });

for (const [name, engine, viewport] of [
  ["chromium", chromium, { width: 320, height: 680 }],
  ["webkit", webkit, { width: 1280, height: 860 }],
]) test(`${name}: workspace tabs keep tools visible and protect challenge content`, async t => {
  const browser = await engine.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport, serviceWorkers: "block", locale: "zh-CN" });
  const fixture = createVisualFixtureSession();
  const primary = "/choirs/visual-choir";
  const requestLog = [];
  await page.route("**/api/**", async route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    requestLog.push(pathname);
    if (pathname === `/api${primary}/sight-singing/questions`) return route.fulfill({ json: { questions: [] } });
    if (pathname === `/api${primary}/sight-singing/leaderboard`) return route.fulfill({ json: { results: [], participants: [] } });
    const result = fixture.resolve({ pathname, method: request.method(), identity: "member" });
    if (pathname === `/api${primary}/bootstrap`) {
      const body = JSON.parse(result.body);
      body.scores = Array.from({ length: 36 }, (_, index) => ({ ...body.scores[0], id: `score-${index}`, fileName: `排练曲目 ${index + 1}.pdf` }));
      result.body = JSON.stringify(body);
    }
    await route.fulfill(result);
  });
  await page.goto(app.origin + primary);
  await expect(page.locator(".file-row")).toHaveCount(36);
  await page.getByRole("searchbox").fill("排练曲目");
  await page.evaluate(() => scrollTo(0, 500));
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(500);

  const navigation = page.getByRole("navigation", { name: "主导航" });
  const tab = label => navigation.getByRole("link", { name: label, exact: true });
  const switchDrive = page.getByRole("button", { name: /^切换云盘/ });
  await expect(tab("乐谱")).toHaveAttribute("aria-current", "page");
  await expect(switchDrive).toBeVisible();
  await tab("工具").click();
  await expect(page).toHaveURL(app.origin + primary + "/tools");
  await expect(tab("工具")).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("searchbox")).toHaveCount(0);
  const challenge = page.getByRole("link", { name: "视唱练习", exact: true });
  await expect(challenge).toHaveAttribute("href", primary + "/sight-singing");
  const rhythm = page.getByRole("article").filter({ hasText: "节奏练习" });
  await expect(rhythm.getByText("筹备中", { exact: true })).toBeVisible();
  await expect(rhythm.getByRole("link").or(rhythm.getByRole("button"))).toHaveCount(0);
  const tools = page.locator(".workspace-tools");
  await expect(tools).toHaveCSS("grid-template-columns", /^[\d.]+px [\d.]+px$/);
  const { y, height } = await tools.boundingBox();
  expect(Math.abs(y + height / 2 - (await navigation.boundingBox()).y / 2)).toBeLessThan(2);
  await challenge.click();
  await expect(page).toHaveURL(app.origin + primary + "/sight-singing");
  await expect(page.locator(".challenge-empty")).toBeVisible();
  await expect(navigation).toHaveCount(0);
  await page.getByRole("button", { name: "返回", exact: true }).click();
  await expect(tab("工具")).toHaveAttribute("aria-current", "page");
  await expect(tab("工具")).toHaveAttribute("href", primary + "/tools");

  await tab("我的").click();
  await expect(page).toHaveURL(app.origin + primary + "/mine");
  await expect(tab("我的")).toHaveAttribute("aria-current", "page");
  await expect(switchDrive).toHaveCount(0);
  await expect(page.getByRole("menu")).toHaveCount(0);
  const drive = page.getByRole("region", { name: "当前云盘" });
  const settings = page.getByRole("region", { name: "应用设置" });
  await expect(drive.getByRole("link", { name: "云盘内身份" })).toHaveAttribute("href", primary + "/me");
  await expect(settings.getByRole("link", { name: "使用手册" })).toHaveAttribute("href", "/help");
  await expect(settings.getByRole("link", { name: "问题反馈" })).toHaveAttribute("href", "/diagnostics");
  await expect(settings.getByRole("link", { name: "视唱练习", exact: true })).toHaveCount(0);
  await tab("乐谱").click();
  await expect(page.getByRole("searchbox")).toHaveValue("排练曲目");
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(500);
  await expect(tab("乐谱")).toHaveAttribute("aria-current", "page");

  await page.goto(app.origin + "/choirs/visual-preview-choir/tools");
  await expect(tab("工具")).toHaveAttribute("aria-current", "page");
  await expect(challenge).toBeVisible();
  await challenge.click();
  await expect(page.getByText("视唱练习仅对当前云盘成员开放。", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "新建题目", exact: true })).toHaveCount(0);
  await page.goto(app.origin + "/choirs/visual-preview-choir/tools?experience=1");
  await expect(tab("工具")).toHaveAttribute("aria-current", "page");
  await expect(challenge).toHaveCount(0);
  expect(new Set(requestLog.filter(pathname => pathname.endsWith("/sight-singing/questions")))).toEqual(new Set([`/api${primary}/sight-singing/questions`]));
});
