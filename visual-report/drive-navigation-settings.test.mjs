import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { before, after, test } from "node:test";
import { chromium, webkit, expect } from "@playwright/test";
import { startVisualServer } from "./setup.mjs";
import { createVisualFixtureSession } from "./fixtures.mjs";
import { chooseLibrarySort, refreshLibrary } from "./navigation-actions.mjs";

let app;
before(async () => { app = await startVisualServer({ script: "dev" }); await mkdir("artifacts/verification/issue-482", { recursive: true }); });
after(async () => app?.stop());

for (const [name, engine] of [["chromium", chromium], ["webkit", webkit]]) {
  test(`${name}: drive switch, independent views, settings hierarchy and compact sort controls`, async t => {
    const browser = await engine.launch(); t.after(() => browser.close());
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
    const page = await context.newPage(); page.setDefaultTimeout(12000);
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    const fixture = createVisualFixtureSession({ id: "library-long-list" });
    let reads = 0;
    await page.route("**/api/**", async route => {
      const request = route.request(), original = new URL(request.url()).pathname;
      const other = original.includes("/other-drive/");
      if (original.endsWith("/settings")) return route.fulfill({ json: { name: other ? "周末排练云盘" : "示例云盘", nameRevision: 0, displayName: "林老师", membershipRevision: 0, canEditDriveInfo: true } });
      const pathname = original.replace("/other-drive/", "/visual-choir/");
      const result = fixture.resolve({ pathname, method: request.method(), identity: "admin", cookie: "" });
      if (pathname.endsWith("/bootstrap")) reads++;
      if (pathname === "/api/choirs") {
        const body = JSON.parse(result.body), first = body.memberships[0];
        body.memberships.push({ ...first, id: "other-membership", choir: { ...first.choir, id: "other-drive", name: "周末排练云盘" } },
          { ...first, id: "preview-membership", choir: { ...first.choir, id: "preview-only", name: "不应列出的公开体验", isPreviewEntry: true } });
        result.body = JSON.stringify(body);
      }
      if (other && pathname.endsWith("/bootstrap")) {
        const body = JSON.parse(result.body); body.choir = { ...body.choir, id: "other-drive", name: "周末排练云盘" };
        body.scores = body.scores.slice(0, 3).map(score => ({ ...score, choirId: "other-drive" })); result.body = JSON.stringify(body);
      }
      await route.fulfill(result);
    });
    await page.goto(`${app.origin}/choirs/visual-choir`);
    await expect(page.locator(".file-row")).toHaveCount(30);
    assert.equal(await page.getByRole("button", { name: "刷新乐谱列表" }).count(), 0);
    const search = await page.getByRole("searchbox").boundingBox(), sort = await page.getByRole("button", { name: /^按.*排序/ }).boundingBox();
    assert.ok(Math.abs(search.y - sort.y) < 8 && search.x + search.width <= sort.x);
    const first = await page.locator(".file-row__name").first().innerText();
    await page.getByRole("button", { name: /^按.*排序/ }).click();
    await page.getByRole("dialog", { name: "乐谱排序" }).getByText("降序（Z → A）", { exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "按名称排序，降序" })).toBeFocused();
    await expect(page.locator(".file-row__name").last()).toHaveText(first);
    await page.getByRole("searchbox").fill("秋日");
    await page.evaluate(() => scrollTo(0, 350));
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(350);
    await page.getByRole("button", { name: /^切换云盘/ }).click();
    const picker = page.getByRole("dialog", { name: "切换云盘" });
    await expect(picker.getByRole("link", { name: /周末排练云盘/ })).toBeVisible();
    await expect(picker.getByText("不应列出的公开体验")).toHaveCount(0);
    const panel = await page.locator(".drive-switch-sheet").boundingBox();
    assert.ok(panel && Math.abs(panel.width - 390) <= 1 && panel.y + panel.height <= 844);
    await page.screenshot({ path: `artifacts/verification/issue-482/${name}-phone-switch.png` });
    await picker.getByRole("link", { name: /周末排练云盘/ }).click();
    await expect(page.getByRole("heading", { name: "周末排练云盘", exact: true })).toBeVisible();
    await expect(page.getByRole("searchbox")).toHaveValue("");
    await expect(page.getByRole("button", { name: "按名称排序，升序" })).toBeVisible();
    await page.getByRole("button", { name: /^切换云盘/ }).click();
    await page.getByRole("dialog", { name: "切换云盘" }).getByRole("link", { name: /示例云盘/ }).click();
    await expect(page.getByRole("searchbox")).toHaveValue("秋日");
    await expect(page.getByRole("button", { name: "按名称排序，降序" })).toBeVisible();
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(350);
    await page.getByRole("link", { name: "云盘设置", exact: true }).click();
    await expect(page.getByRole("heading", { name: "云盘设置", exact: true, level: 1 })).toBeVisible();
    assert.equal(await page.locator(".drive-context-row").count(), 0);
    await expect(page.getByRole("main").getByRole("navigation", { name: "云盘设置分类" })).toBeVisible();
    await page.screenshot({ path: `artifacts/verification/issue-482/${name}-phone-settings.png` });
    await page.getByRole("link", { name: "成员与权限", exact: true }).click();
    await expect(page.getByRole("heading", { name: "成员与权限", exact: true, level: 1 })).toBeVisible();
    await page.getByRole("button", { name: "返回", exact: true }).click();
    await expect(page.getByRole("heading", { name: "云盘设置", level: 1 })).toBeVisible();
    await page.getByRole("button", { name: "返回", exact: true }).click();
    await page.getByRole("button", { name: "我的", exact: true }).click();
    for (const item of ["阅读偏好", "本机存储", "账户", "问题反馈", "退出登录"]) await expect(page.getByRole("menuitem", { name: item, exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    const beforeRefresh = reads;
    await refreshLibrary(page);
    await expect.poll(() => reads).toBeGreaterThan(beforeRefresh);
    await expect(page.getByRole("searchbox")).toHaveValue("秋日");
    await chooseLibrarySort(page, "updated");
    await expect(page.getByRole("button", { name: "按最近更新排序，最新在前" })).toBeVisible();
    for (const width of [320, 680, 681, 834, 1112]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${width}: no horizontal overflow`);
      for (const control of [page.getByRole("button", { name: /^切换云盘/ }), page.getByRole("link", { name: "云盘设置", exact: true }), page.getByRole("button", { name: /^按.*排序/ })]) {
        const box = await control.boundingBox(); assert.ok(box.width >= 44 && box.height >= 44 && box.x >= 0 && box.x + box.width <= width);
      }
    }
    await page.setViewportSize({ width: 834, height: 1112 });
    await page.getByRole("link", { name: "云盘设置", exact: true }).click();
    await expect(page.getByRole("main").getByRole("heading", { name: "基本信息", level: 2 })).toBeVisible();
    await page.getByRole("link", { name: "加入方式", exact: true }).click();
    await expect(page.getByRole("heading", { name: "云盘设置", exact: true, level: 1 })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "云盘设置分类" })).toBeVisible();
    await page.screenshot({ path: `artifacts/verification/issue-482/${name}-tablet-settings.png` });
    await page.getByRole("link", { name: "基本信息", exact: true }).click();
    await page.getByRole("button", { name: "修改云盘名称", exact: true }).click();
    const input = page.getByRole("textbox", { name: "云盘名称", exact: true });
    await input.fill("旋转后仍保留的草稿");
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(input).toHaveValue("旋转后仍保留的草稿");
    await page.setViewportSize({ width: 1112, height: 834 });
    await expect(input).toHaveValue("旋转后仍保留的草稿");
    assert.deepEqual(errors, []);
  });
}

test("chromium: native downward touch refreshes only the library and cancelled gestures do not refresh", async t => {
  const browser = await chromium.launch(); t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, serviceWorkers: "block" });
  const page = await context.newPage();
  const fixture = createVisualFixtureSession({ id: "library-long-list" });
  let reads = 0;
  await page.route("**/api/**", route => {
    const request = route.request(), pathname = new URL(request.url()).pathname;
    if (pathname.endsWith("/bootstrap")) reads++;
    return route.fulfill(fixture.resolve({ pathname, method: request.method(), identity: "admin", cookie: "" }));
  });
  await page.goto(`${app.origin}/choirs/visual-choir`);
  await expect(page.locator(".file-row")).toHaveCount(30);
  await page.getByRole("searchbox").fill("秋日");
  await chooseLibrarySort(page, "updated");
  await page.evaluate(() => { window.__refreshDocumentMarker = "same-document"; });
  const client = await context.newCDPSession(page);
  async function gesture(dx, dy, cancel = false) {
    const y = (await page.locator(".file-row").first().boundingBox()).y + 20;
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 140, y, id: 1 }] });
    for (let step = 1; step <= 6; step++) await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 140 + dx * step / 6, y: y + dy * step / 6, id: 1 }] });
    await client.send("Input.dispatchTouchEvent", { type: cancel ? "touchCancel" : "touchEnd", touchPoints: [] });
  }
  const before = reads;
  await gesture(100, 5);
  await gesture(0, 140, true);
  assert.equal(reads, before, "Horizontal and cancelled input must not refresh");
  await gesture(0, 150);
  await expect.poll(() => reads).toBe(before + 1);
  await expect(page.getByRole("searchbox")).toHaveValue("秋日");
  await expect(page.getByRole("button", { name: "按最近更新排序，最新在前" })).toBeVisible();
  assert.equal(await page.evaluate(() => window.__refreshDocumentMarker), "same-document");
  assert.equal(await page.evaluate(() => scrollY), 0);
  await page.getByRole("link", { name: "云盘设置", exact: true }).click();
  await page.getByRole("heading", { name: "云盘设置", exact: true, level: 1 }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.style.overscrollBehaviorY), "", "Reader/settings retain their original document gesture policy");
});
