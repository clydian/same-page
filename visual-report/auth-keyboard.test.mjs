import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, webkit, expect } from "@playwright/test";
import { startVisualServer } from "./setup.mjs";
import { resolveFixtureRequest } from "./fixtures.mjs";

let server;
before(async () => { server = await startVisualServer({ script: "dev", cwd: process.cwd() }); });
after(async () => server?.stop());

for (const [name, engine] of [["chromium", chromium], ["webkit", webkit]]) {
  test(`${name}: focused OTP remains above a keyboard after returning from email`, async t => {
    const browser = await engine.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.setDefaultTimeout(10000);
    // Model resize-visual: the keyboard shrinks the visible area but leaves
    // layout, CSS viewport units and native document scroll limits unchanged.
    // Desktop Playwright does not open a real OS keyboard.
    await page.addInitScript(() => {
      const viewport = Object.assign(new EventTarget(), { height: 844, offsetTop: 0, scale: 1 });
      Object.defineProperty(window, "visualViewport", { value: viewport });
    });
    await page.route("**/api/**", route => {
      const pathname = new URL(route.request().url()).pathname;
      const body = pathname === "/api/auth/flow" ? { flow: "set-password", hasGoogle: false }
        : pathname === "/api/auth/social-providers" ? { providers: [] }
        : pathname === "/api/auth/email-otp/request-password-reset" ? { success: true } : null;
      if (body) return route.fulfill({ json: body });
      return route.fulfill(resolveFixtureRequest({ pathname, method: route.request().method(), scenarioId: "auth-login" }) ?? { status: 404, json: {} });
    });
    await page.goto(`${server.origin}/login`);
    await page.getByLabel("邮箱", { exact: true }).fill("singer@example.test");
    await page.getByRole("button", { name: "继续", exact: true }).click();
    await page.getByRole("button", { name: "设置密码，以后用邮箱登录" }).click();
    const otp = page.getByLabel("六位验证码");
    await otp.fill("12");
    await page.evaluate(() => {
      window.visualViewport.height = 220;
      window.dispatchEvent(new Event("pageshow"));
      window.visualViewport.dispatchEvent(new Event("resize"));
    });
    await expect(otp).toBeFocused();
    await expect(otp).toHaveValue("12");
    await expect.poll(async () => otp.evaluate(input => {
      const bounds = input.getBoundingClientRect();
      const viewport = window.visualViewport;
      return bounds.top >= viewport.offsetTop && bounds.bottom <= viewport.offsetTop + viewport.height;
    }), { message: "OTP must actually be inside the area above the keyboard", timeout: 2000 }).toBe(true);
    assert.equal(await page.evaluate(() => innerHeight), 844, "layout viewport must remain unchanged");
    // iOS can pan the visual viewport without resizing it while restoring focus.
    await page.evaluate(() => {
      window.visualViewport.offsetTop = 180;
      window.visualViewport.dispatchEvent(new Event("scroll"));
    });
    await expect.poll(() => otp.evaluate(input => input.getBoundingClientRect().top), {
      message: "pan-only viewport changes must also keep the OTP visible",
    }).toBeGreaterThanOrEqual(180);
    await page.evaluate(() => {
      window.visualViewport.height = 844;
      window.visualViewport.offsetTop = 0;
      window.visualViewport.dispatchEvent(new Event("resize"));
    });
    await expect.poll(() => page.locator(".auth-page").evaluate(element => element.style.getPropertyValue("--input-keyboard-inset"))).toBe("0px");
    await expect(otp).toBeFocused();
    await expect(otp).toHaveValue("12");
    assert.equal(await page.evaluate(() => document.documentElement.scrollHeight), 844, "closing the keyboard must remove the temporary scroll space");
  });
}

test("chromium: native visual viewport pan recovers OTP at document scroll zero", async t => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  await page.route("**/api/**", route => {
    const pathname = new URL(route.request().url()).pathname;
    const body = pathname === "/api/auth/flow" ? { flow: "set-password", hasGoogle: false }
      : pathname === "/api/auth/social-providers" ? { providers: [] }
      : pathname === "/api/auth/email-otp/request-password-reset" ? { success: true } : null;
    if (body) return route.fulfill({ json: body });
    return route.fulfill(resolveFixtureRequest({ pathname, method: route.request().method(), scenarioId: "auth-login" }) ?? { status: 404, json: {} });
  });
  await page.goto(`${server.origin}/login`);
  await page.getByLabel("邮箱", { exact: true }).fill("singer@example.test");
  await page.getByRole("button", { name: "继续", exact: true }).click();
  await page.getByRole("button", { name: "设置密码，以后用邮箱登录" }).click();
  const otp = page.getByLabel("六位验证码");
  await otp.fill("12");
  // Unlike the resize-visual model above, this uses the browser's real visual
  // viewport. Document scrolling cannot recover an input above a panned visual
  // viewport when the document has already reached scrollY = 0.
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 2 });
  await cdp.send("Input.synthesizeScrollGesture", {
    x: 180, y: 300, yDistance: -450, speed: 1000, gestureSourceType: "touch",
  });
  await expect.poll(() => otp.evaluate(input => {
    const bounds = input.getBoundingClientRect();
    const viewport = window.visualViewport;
    return bounds.top >= viewport.offsetTop && bounds.bottom <= viewport.offsetTop + viewport.height;
  }), { message: "native visual viewport pan must recover the OTP even at document scroll zero", timeout: 2000 }).toBe(true);
  assert.equal(await page.evaluate(() => scrollY), 0);
  assert.equal(await page.locator(".auth-page").evaluate(element => element.style.getPropertyValue("--input-keyboard-inset")), "0px", "pinch zoom must not create keyboard padding");
  await expect(otp).toBeFocused();
  await expect(otp).toHaveValue("12");
});
