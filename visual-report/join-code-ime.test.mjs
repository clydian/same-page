import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, expect } from "@playwright/test";
import { startVisualServer } from "./setup.mjs";
import { createVisualFixtureSession } from "./fixtures.mjs";

let app;
before(async () => { app = await startVisualServer({ script: "dev" }); });
after(async () => app?.stop());

test("join code preserves native IME replacement and only submits committed text", async t => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  page.setDefaultTimeout(10000);
  const fixture = createVisualFixtureSession({ id: "library-long-list" });
  const admissions = [];
  await page.route("**/api/**", route => {
    const request = route.request(), pathname = new URL(request.url()).pathname;
    if (pathname === "/api/guest/session" && request.method() === "POST") {
      admissions.push(request.postDataJSON());
      return route.fulfill({ status: 403, json: { error: "Invalid join code" } });
    }
    return route.fulfill(fixture.resolve({ pathname, method: request.method(), identity: "guest", cookie: "" }));
  });
  await page.goto(`${app.origin}/?join=1`);
  const input = page.getByRole("textbox", { name: "邀请码", exact: true });
  await input.focus();
  const cdp = await page.context().newCDPSession(page);
  const compose = text => cdp.send("Input.imeSetComposition", { text, selectionStart: text.length, selectionEnd: text.length });
  await expect(input).toHaveCSS("opacity", "1");
  await expect(input).toHaveCSS("text-transform", "uppercase");

  // This must use the browser's native composition range. Synthetic DOM
  // composition events alone cannot detect the original AASAS duplication.
  await compose("a");
  await expect(input).toHaveValue("a");
  await compose("as");
  await expect(input).toHaveValue("as");
  assert.equal((await page.locator(".join-code-slot").allTextContents()).join(""), "as");
  await cdp.send("Input.insertText", { text: "as" });
  await expect(input).toHaveValue("as");
  await expect(input).toHaveValue("as");

  await input.fill("abcdefgh");
  await expect(page.getByRole("button", { name: "进入", exact: true })).toBeEnabled();
  await input.selectText();
  await compose("a");
  await expect(page.getByRole("button", { name: "进入", exact: true })).toBeDisabled();
  // A direct form submission must also reject the previous complete code.
  await input.evaluate(element => element.form.requestSubmit());
  assert.equal(admissions.length, 0);
  await compose("as");
  await cdp.send("Input.insertText", { text: "as" });
  await expect(input).toHaveValue("as");
  await expect(page.getByRole("button", { name: "进入", exact: true })).toBeDisabled();

  await input.fill("ABCDEFGHJKLMNPQR");
  await expect(input).toHaveValue("ABCDEFGH");
  await expect(page.getByRole("status", { name: "截断提示" })).toContainText("仅保留前八位");
  await input.press("Backspace");
  await expect(input).toHaveValue("ABCDEFG");
  await input.fill("你".repeat(32));
  await expect(input).toHaveValue("你".repeat(8));
  await page.keyboard.insertText("a");
  await expect(input).toHaveValue("你".repeat(8));

  await input.fill("");
  await compose("a".repeat(12));
  await expect(input).toHaveValue("a".repeat(12));
  await expect(page.locator(".join-code-slot")).toHaveCount(8);
  await cdp.send("Input.insertText", { text: "a".repeat(12) });
  await expect(input).toHaveValue("a".repeat(8));

  await input.fill("");
  await compose("n");
  await compose("ni");
  await cdp.send("Input.insertText", { text: "你" });
  await expect(input).toHaveValue("你");
  await page.keyboard.insertText("a");
  await expect(input).toHaveValue("你a");
  await expect(page.getByRole("alert")).toContainText("中文");

  await input.fill("abgh");
  await input.evaluate(element => element.setSelectionRange(2, 2));
  await page.keyboard.insertText(" c-d ");
  await expect(input).toHaveValue("abcdgh");
  assert.equal(await input.evaluate(element => element.selectionStart), 4);
  await page.keyboard.insertText("e");
  await expect(input).toHaveValue("abcdegh");

  // Pointer editing must target the displayed cell, including wide invalid
  // characters; native text metrics are not the visual slot positions.
  await input.fill("ab cd-efgh");
  const control = await page.locator(".join-code-control").boundingBox();
  const at = (cell, fraction = 0.25) => ({ x: control.x + control.width * (cell + fraction) / 8, y: control.y + control.height / 2 });
  await page.mouse.click(at(4).x, at(4).y);
  await input.press("Backspace");
  await expect(input).toHaveValue("abcefgh");
  await input.fill("你好吗23456");
  await page.mouse.click(at(2).x, at(2).y);
  await page.keyboard.insertText("x");
  await expect(input).toHaveValue("你好x吗2345");
  await input.fill("abcdefgh");
  await page.mouse.move(at(1).x, at(1).y);
  await page.mouse.down();
  await page.mouse.move(at(4).x, at(4).y);
  await page.mouse.up();
  assert.equal(await input.evaluate(element => element.selectionStart), 1);
  assert.equal(await input.evaluate(element => element.selectionEnd), 4);
  await page.keyboard.insertText("s");
  await expect(input).toHaveValue("asefgh");
  await page.keyboard.down("Shift");
  await page.mouse.click(at(4).x, at(4).y);
  await page.keyboard.up("Shift");
  assert.equal(await input.evaluate(element => element.selectionStart), 2);
  assert.equal(await input.evaluate(element => element.selectionEnd), 4);

  await input.fill("ABIO2345");
  await expect(input).toHaveValue("ABIO2345");
  await expect(page.getByRole("alert")).toContainText("不含 I、O、0、1");
  await expect(page.getByRole("button", { name: "进入", exact: true })).toBeDisabled();
  await input.evaluate(element => element.form.requestSubmit());
  assert.equal(admissions.length, 0);

  // Editing preserves the complete draft; only a validated submission uses
  // a canonical uppercase code without presentation separators.
  await input.fill("ab cd-efgh");
  await expect(input).toHaveValue("abcdefgh");
  await input.evaluate(element => element.setSelectionRange(1, 2));
  await page.keyboard.insertText("s");
  await expect(input).toHaveValue("ascdefgh");
  await page.getByRole("button", { name: "进入", exact: true }).click();
  await expect.poll(() => admissions.length).toBe(1);
  assert.deepEqual(admissions[0], { admission: "invite", joinCode: "ASCDEFGH" });
});
