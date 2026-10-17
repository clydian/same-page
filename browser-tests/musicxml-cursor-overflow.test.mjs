import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, readdir } from 'node:fs/promises';
import { chromium, webkit, expect } from '@playwright/test';
import { startStorageFixture } from './storage-fixture.mjs';

// Isolate the WebKit CSS failure using alphaTab's native cursor DOM/styles and
// the actual built host stylesheet. Full MusicXML integration is exercised by
// musicxml-playback and the reader split/pinch suites; this is not a source-score
// fixture. No screenshot or paint-forcing workaround precedes the assertions.
// A responsive cursor canvas emulates renderer sizing without a manual width
// write that would invalidate WebKit's stale overflow before we can observe it.
for (const [engine, type] of [['chromium', chromium], ['webkit', webkit]]) {
  test(`built host cursor layer contains stale transformed overflow (${engine})`, { timeout: 60000 }, async t => {
    const fixture = await startStorageFixture();
    let browser;
    t.after(async () => { try { await browser?.close(); } finally { await fixture.stop(); } });
    browser = await type.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    await page.goto(fixture.origin);
    // Playback CSS is a lazy route asset; load the built stylesheets without
    // replacing them with hand-copied host CSS in this isolated DOM test.
    const stylesheets = (await readdir('dist/client/assets')).filter(name => name.endsWith('.css'));
    for (const name of stylesheets) await page.addStyleTag({ url: `${fixture.origin}/assets/${name}` });
    await page.evaluate(() => {
      document.body.innerHTML = `<section class="practice-notation" data-visible style="position:static;display:block;visibility:visible;padding:0">
        <div class="practice-notation-scroll" style="position:fixed;inset:53px 0 65px;overflow:auto;padding:8px"><div class="practice-notation-paper">
          <div class="alphaTab" style="position:relative;height:18000px">
            <div class="at-cursors" style="position:absolute;pointer-events:none;z-index:1000;width:100%;height:18000px">
              <div class="at-cursor-bar" style="position:absolute;left:0;top:0;width:100px;height:100px;transform-origin:left top;will-change:transform;transform:translate(610px,4500px) scale(1.1,3.138)"></div>
              <div class="at-cursor-beat" style="position:absolute;left:0;top:0;width:300px;height:100px;transform-origin:left top;will-change:transform;transform:translate(626px,4500px) scale(.01,3.138) translateX(-50%)"></div>
            </div>
            <div class="at-surface" style="position:relative;overflow:hidden;width:100%;height:18000px"></div>
          </div>
        </div></div>
      </section>`;
    });
    const cursor = page.locator('.at-cursor-beat');
    await expect.poll(() => cursor.evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(189, 119, 64)');
    // Let the old desktop cursor layer reach the compositor before resizing.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => {
      document.querySelector('.at-cursor-bar').style.transform = 'translate(203px,17200px) scale(1.1,3.138)';
      document.querySelector('.at-cursor-beat').style.transform = 'translate(219px,17200px) scale(.01,3.138) translateX(-50%)';
      document.querySelector('.practice-notation-scroll').scrollTop = 17100;
    });
    const scrollGeometry = () => page.locator('.practice-notation-scroll').evaluate(viewport => {
      const before = viewport.scrollLeft;
      const width = viewport.clientWidth, scrollWidth = viewport.scrollWidth;
      viewport.scrollLeft = 100000;
      const rightPan = viewport.scrollLeft;
      viewport.scrollLeft = before;
      return { width, scrollWidth, rightPan };
    });
    await expect.poll(async () => {
      const value = await scrollGeometry();
      return { overflow: value.scrollWidth - value.width, rightPan: value.rightPan };
    }, { timeout: 20000 }).toEqual({ overflow: 0, rightPan: 0 });
    const line = await cursor.boundingBox();
    assert.ok(line.width >= 2.5 && line.height > 300, 'containment retains the native three-pixel line');
    // Emulate native seek positions at each canvas edge without changing the
    // cursor's width/scale contract or hiding it to cure scroll overflow.
    for (const edge of ['left', 'right']) {
      await cursor.evaluate((element, edge) => {
        const width = element.closest('.at-cursors').clientWidth;
        const center = edge === 'left' ? 1.5 : width - 1.5;
        element.style.transform = `translate(${center}px,17200px) scale(.01,3.138) translateX(-50%)`;
      }, edge);
      const bounds = await cursor.evaluate(element => {
        const line = element.getBoundingClientRect(), canvas = element.closest('.at-cursors').getBoundingClientRect();
        return { width: line.width, left: line.left - canvas.left, right: line.right - canvas.right };
      });
      assert.ok(bounds.width >= 2.5 && bounds.left >= -0.1 && bounds.right <= 0.1, `line remains inside the ${edge} canvas edge`);
      assert.equal((await scrollGeometry()).rightPan, 0);
    }

    // A genuinely wide content surface must still scroll. This is a 600px
    // content control, not a claim that alphaTab makes a particular bar wide.
    await page.locator('.at-surface').evaluate(surface => {
      surface.style.width = '600px';
      surface.style.background = 'linear-gradient(to right, white, lightblue)';
    });
    await expect.poll(async () => {
      const value = await scrollGeometry();
      return value.scrollWidth > value.width && value.rightPan > 0;
    }, { timeout: 20000 }).toBe(true);
    await mkdir('artifacts/verification/cursor-overflow', { recursive: true });
    await page.screenshot({ path: `artifacts/verification/cursor-overflow/${engine}-synthetic-host-css-wide-content.png` });
  });
}
