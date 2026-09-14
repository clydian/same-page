import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir } from "node:fs/promises";
import test from "node:test";
import { chromium, webkit, expect } from "@playwright/test";
import { startVisualServer } from "./setup.mjs";
import { createSampleScorePdf, resolveFixtureRequest } from "./fixtures.mjs";

// Real fetch streaming + PDF.js, with one controlled pause halfway through the
// bytes. A routed, already-buffered fulfill would not exercise download progress.
test("reader shows real known/unknown transfer progress and retires it only after painting", async t => {
  const server = await startVisualServer({ script: "dev" });
  t.after(() => server.stop());
  const pdf = createSampleScorePdf();
  let finish;
  const stream = createServer((request, response) => {
    response.writeHead(200, { "Content-Type": "application/pdf", "Access-Control-Allow-Origin": server.origin,
      "Access-Control-Allow-Credentials": "true", "Cache-Control": "no-store",
      ...(request.url === "/known" ? { "Content-Length": pdf.length } : {}) });
    response.write(pdf.subarray(0, Math.floor(pdf.length / 2)));
    finish = () => response.end(pdf.subarray(Math.floor(pdf.length / 2)));
  });
  await new Promise(resolve => stream.listen(0, "127.0.0.1", resolve));
  t.after(() => { stream.closeAllConnections(); stream.close(); });
  await mkdir("artifacts/verification/reader-opening", { recursive: true });
  for (const [engineName, engine] of [["chromium", chromium], ["webkit", webkit]]) {
    const browser = await engine.launch({ headless: true });
    try {
      for (const total of ["known", "unknown"]) {
        const context = await browser.newContext({ serviceWorkers: "block", viewport: total === "known" ? { width: 820, height: 1180 } : { width: 320, height: 740 } });
        const page = await context.newPage();
        await context.route("**/api/**", async route => {
          const pathname = new URL(route.request().url()).pathname;
          if (pathname.endsWith("/pdf") && route.request().method() === "GET") return route.continue({ url: `http://127.0.0.1:${stream.address().port}/${total}` });
          return route.fulfill(resolveFixtureRequest({ pathname, method: route.request().method(), identity: "member", cookie: "" }));
        });
        const pdfRequest = page.waitForRequest(request => new URL(request.url()).pathname.endsWith("/pdf") && request.method() === "GET");
        await page.goto(`${server.origin}/choirs/visual-choir/scores/visual-score`, { waitUntil: "domcontentloaded" });
        await pdfRequest;
        const progress = page.getByRole("progressbar", { name: "PDF 文件加载进度" });
        await expect(progress).toBeVisible();
        if (total === "known") {
          await expect(progress).toHaveAttribute("value", String(Math.floor(pdf.length / 2)));
          await expect(progress).toHaveAttribute("max", String(pdf.length));
        } else {
          await expect(page.getByText(/已获取$/)).toBeVisible();
          assert.equal(await progress.getAttribute("value"), null);
        }
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await page.screenshot({ path: `artifacts/verification/reader-opening/${engineName}-${total}.png` });
        finish();
        await expect(page.getByRole("main", { name: "正在加载乐谱" })).toHaveCount(0);
        await expect(page.getByRole("img", { name: "第 1 页", exact: true })).toBeVisible();
        await context.close();
      }
    } finally { await browser.close(); }
  }
});
