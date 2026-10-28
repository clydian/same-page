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
  const slots = page.locator(".join-code-slot");

  // This must use the browser's native composition range. Synthetic DOM
  // composition events alone cannot detect the original AASAS duplication.
  await compose("a");
  await expect(input).toHaveValue("a");
  await compose("as");
  await expect(input).toHaveValue("as");
  await cdp.send("Input.insertText", { text: "as" });
  await expect(input).toHaveValue("as");
  await expect(slots).toHaveText(["A", "S", "", "", "", "", "", ""]);

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
  await expect(slots).toHaveText(["A", "S", "", "", "", "", "", ""]);
  await expect(page.getByRole("button", { name: "进入", exact: true })).toBeDisabled();

  await input.fill("ABCDEFGHJKLMNPQR");
  await expect(input).toHaveValue("ABCDEFGH");
  await input.press("Backspace");
  await expect(slots).toHaveText(["A", "B", "C", "D", "E", "F", "G", ""]);
  await input.fill("你".repeat(32));
  await expect(input).toHaveValue("");
  await page.keyboard.insertText("a");
  await expect(input).toHaveValue("a");

  await input.fill("");
  await compose("n");
  await compose("ni");
  await cdp.send("Input.insertText", { text: "你" });
  await expect(input).toHaveValue("");
  await page.keyboard.insertText("a");
  await expect(slots).toHaveText(["A", "", "", "", "", "", "", ""]);

  await input.fill("abgh");
  await input.evaluate(element => element.setSelectionRange(2, 2));
  await page.keyboard.insertText(" c-d ");
  await expect(input).toHaveValue("abcdgh");
  assert.equal(await input.evaluate(element => element.selectionStart), 4);
  await page.keyboard.insertText("e");
  await expect(input).toHaveValue("abcdegh");

  // Normal editing keeps selection and letter case while cleaning separators;
  // admission receives the canonical uppercase value.
  await input.fill("ab cd-efgh");
  await expect(input).toHaveValue("abcdefgh");
  await input.evaluate(element => element.setSelectionRange(1, 2));
  await page.keyboard.insertText("s");
  await expect(input).toHaveValue("ascdefgh");
  await page.getByRole("button", { name: "进入", exact: true }).click();
  await expect.poll(() => admissions.length).toBe(1);
  assert.deepEqual(admissions[0], { admission: "invite", joinCode: "ASCDEFGH" });
});
