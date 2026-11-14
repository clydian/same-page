import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { startConnectionFixture } from '../browser-tests/connection-fixture.mjs';

// Transport faults and test-clock changes exercise the actual controller and
// component. Never replace their snapshots, navigator getters or DOM labels.
const output = path.resolve(process.argv[2] ?? 'docs/operations/connection-status-mismatch/states');
await mkdir(output, { recursive: true });
const source = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const fixture = await startConnectionFixture();
let browser;
const cases = [];
const definitions = [
  ['normal', '正常示例', '有效测试会话，最近探测成功；仅表示线路可达。'],
  ['checking', '检测中', '测试延迟健康请求，实际检查仍在进行。'],
  ['browser-offline', '浏览器离线', '真实浏览器断网；保留断网前的成功记录。'],
  ['unreachable', '连接异常', '浏览器仍联网，测试阻断两条线路的健康请求。'],
  ['conflict', '身份需处理', '测试用户 A 的页面，直连入口实际改登测试用户 B。'],
  ['unprepared', '身份待确认', '测试令身份检测接口返回 503；健康接口仍成功。'],
  ['unmeasured', '尚未检测 · 展开', '首次健康请求尚未完成，展开采样详情。'],
  ['expired', '结果已过期 · 展开', '测试时钟跳过 46 秒，下一次采样尚未执行。'],
];
try {
  browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {});
  let authenticatedState;
  for (const [name, title, trigger] of definitions) {
    const context = await browser.newContext({ ...(authenticatedState ? { storageState: authenticatedState } : {}), viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Shanghai', ignoreHTTPSErrors: true, serviceWorkers: 'block', reducedMotion: 'reduce', isMobile: true, hasTouch: true });
    const page = await context.newPage();
    context.setDefaultTimeout(12_000);
    const blocked = [];
    try {
      await page.clock.install();
      await page.goto(fixture.origins.direct + '/login');
      if (!authenticatedState) assert.equal(await page.evaluate(async account => (await fetch('/api/_entry/direct/auth/sign-in/email', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(account) })).status, fixture.accounts[0]), 200);
      await page.goto(`${fixture.origins.direct}/choirs/${fixture.choirId}`);
      await expect(page.locator('.file-row__open').first()).toBeVisible();
      const snapshot = () => page.evaluate(async () => (await import('/src/client/connection/connection.ts')).connections.getSnapshot());
      const check = () => page.evaluate(async () => (await import('/src/client/connection/connection.ts')).connections.check());
      await expect.poll(async () => (await snapshot()).identity.backup).toBe('ready');
      await page.evaluate(async () => { const { connections } = await import('/src/client/connection/connection.ts'); connections.setMode('direct'); await connections.check(); });
      await expect.poll(async () => (await snapshot()).checking || (await snapshot()).preparing).toBe(false);
      authenticatedState ??= await context.storageState();
      const button = page.getByRole('button', { name: /^连接线路/ });
      const entry = async () => {
        await expect(button).toBeVisible();
        assert.equal((await button.textContent()).trim(), '', 'connection entry must be icon-only');
        await page.clock.runFor(80);
        await button.screenshot({ path: path.join(output, `${name}-entry.png`) });
      };
      const panel = async () => {
        await page.clock.runFor(80);
        await page.locator('.connection-dialog').screenshot({ path: path.join(output, `${name}-panel.png`) });
      };
      const open = async () => {
        await button.click();
        await expect(page.getByRole('dialog', { name: '连接线路' })).toBeVisible();
      };
      const warm = async () => {
        await open();
        await expect(page.locator('.connection-health').filter({ hasText: '线路可达' })).toHaveCount(2);
        await expect.poll(async () => (await snapshot()).checking || (await snapshot()).preparing).toBe(false);
      };
      if (name === 'checking' || name === 'unmeasured') {
        await page.route('**/api/_entry/*/health', async route => {
          await new Promise(resolve => blocked.push(resolve));
          await route.abort('aborted').catch(() => {});
        });
        await page.evaluate(() => { void import('/src/client/connection/connection.ts').then(({ connections }) => connections.check()); });
        await expect(button).toHaveAccessibleName(/正在检测/);
        await entry();
        await open();
        await expect(page.locator('.connection-health').filter({ hasText: '尚未检测' })).toHaveCount(2);
        if (name === 'unmeasured') {
          await page.getByLabel(/^直连检测详情/).click();
          await expect(page.getByText('尚未完成检测。').first()).toBeVisible();
        }
        await panel();
      } else if (name === 'browser-offline') {
        await warm();
        await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now() + 1000)));
        const successful = (await snapshot()).samples.direct.at(-1);
        await context.setOffline(true);
        await expect(page.locator('.connection-current')).toContainText('浏览器离线');
        assert.deepEqual((await snapshot()).samples.direct.at(-1), successful);
        await panel();
        await page.clock.resume();
        await page.getByRole('button', { name: '关闭连接面板' }).click();
        await expect(button).toHaveAccessibleName(/浏览器离线/);
        await entry();
      } else if (name === 'expired') {
        await warm();
        const previous = (await snapshot()).samples.direct.at(-1);
        await page.clock.setSystemTime(new Date(await page.evaluate(() => Date.now() + 46_000)));
        await page.clock.runFor(1000);
        await expect(page.getByText('结果已过期', { exact: true })).toHaveCount(2);
        await expect(page.locator('.connection-current')).toContainText('待检测');
        assert.deepEqual((await snapshot()).samples.direct.at(-1), previous);
        await page.getByLabel(/^直连检测详情/).click();
        await panel();
        await page.getByRole('button', { name: '关闭连接面板' }).click();
        await entry();
      } else {
        if (name === 'unreachable') {
          await page.route('**/api/_entry/*/health', route => route.abort('connectionfailed'));
          await check();
          await expect(button).toHaveAccessibleName(/连接异常/);
        } else if (name === 'conflict') {
          assert.equal(await page.evaluate(async account => (await fetch('/api/_entry/direct/auth/sign-in/email', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(account) })).status, fixture.accounts[1]), 200);
          await check();
          await expect(button).toHaveAccessibleName(/需处理/);
        } else if (name === 'unprepared') {
          await page.route('**/api/_entry/*/connection/status', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"synthetic_status_unavailable"}' }));
          await check();
          assert.equal((await snapshot()).identity.direct, 'unprepared');
        }
        await entry();
        await open();
        await expect.poll(async () => (await snapshot()).checking || (await snapshot()).preparing).toBe(false);
        if (name === 'unreachable') await expect(page.locator('.connection-health').filter({ hasText: '暂时连不上' })).toHaveCount(2);
        else if (name === 'conflict') await expect(page.getByText('登录不一致', { exact: true })).toHaveCount(1);
        else if (name === 'unprepared') await expect(page.locator('.connection-current')).toContainText('待确认');
        else await expect(page.locator('.connection-health').filter({ hasText: '线路可达' })).toHaveCount(2);
        await panel();
      }
      const state = await snapshot();
      const record = { name, title, trigger, navigatorOnline: await page.evaluate(() => navigator.onLine), active: state.active, checking: state.checking, preparing: state.preparing, identity: state.identity, latestSamples: Object.fromEntries(Object.entries(state.samples).map(([key, values]) => [key, values.at(-1)?.state ?? null])), entry: `${name}-entry.png`, panel: `${name}-panel.png` };
      cases.push(record);
      console.log(JSON.stringify({ name, captured: true }));
    } finally {
      blocked.forEach(resolve => resolve());
      await context.close();
    }
  }
  const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  const data = async file => `data:image/png;base64,${(await readFile(path.join(output, file))).toString('base64')}`;
  const cards = [];
  for (const [index, item] of cases.entries()) cards.push(`<article><h2>${String(index + 1).padStart(2, '0')} ${escape(item.title)}</h2><p>${escape(item.trigger)}</p><div class="entry"><span>实际入口</span><img src="${await data(item.entry)}"></div><img class="panel" src="${await data(item.panel)}"></article>`);
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>#652 连接状态真实界面对照</title><style>*{box-sizing:border-box}body{margin:0;padding:38px;background:#eaf0f0;color:#17353a;font-family:system-ui,"Noto Sans CJK SC",sans-serif;width:1800px}header{margin:0 0 26px}h1{font-size:38px;margin:0 0 12px}header p{font-size:21px;line-height:1.55;margin:6px 0}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:20px;align-items:start}article{background:white;border:1px solid #d6e0df;border-radius:16px;padding:16px}h2{font-size:26px;margin:0 0 10px}article>p{font-size:18px;line-height:1.5;min-height:82px;margin:0 0 12px}.entry{min-height:66px;display:flex;align-items:center;gap:16px;padding:8px 0 12px}.entry span{font-size:16px;color:#607378}.entry img{max-height:46px;width:auto;max-width:230px}.panel{width:100%;height:auto;display:block;border:1px solid #dfe7e6;border-radius:8px}footer{font-size:19px;line-height:1.6;margin:28px 0 0;color:#425c61}</style><header><h1>#652 · 八种连接状态，实际界面对照</h1><p><b>全部为隔离测试触发，不是用户设备故障实录。</b> 原图来自正在运行的页面；这里只做排版和标注，没有重绘 UI。</p><p>最新默认布局：长解释收在“状态与连接帮助”。每格上方是无文字入口，下面是对应面板；各格固定直连便于比较，不是自动切换截图证据。</p></header><main class="grid">${cards.join('')}</main><footer>浏览器离线读取浏览器信号；连接异常读取当前线路连通性证据；需处理读取入口会话一致性。入口不显示文字，图标与警示色表达概况；没有警示也不能当成全部功能正常。<br>检查延迟、请求阻断、503 与时钟跳转均为测试条件；“浏览器离线”格为真实浏览器断网。“正常示例”只展示有效测试会话和可达证据。源码 ${escape(source.slice(0, 7))} · Chromium ${escape(browser.version())} · 原始面板宽 390px。</footer></html>`;
  await writeFile(path.join(output, 'capture.json'), JSON.stringify({ source, browser: browser.version(), timezone: 'Asia/Shanghai', conditions: 'isolated Worker/D1/R2; service workers blocked; no product DOM or controller snapshots patched', cases }, null, 2) + '\n');
  const gallery = await browser.newPage({ viewport: { width: 1800, height: 1200 }, deviceScaleFactor: 1 });
  await gallery.setContent(html);
  await gallery.evaluate(() => document.fonts.ready);
  await gallery.screenshot({ path: path.join(output, 'same-page-652-connection-state-gallery.png'), fullPage: true });
  console.log(JSON.stringify({ source, cases: cases.length, gallery: path.join(output, 'same-page-652-connection-state-gallery.png') }));
} finally {
  await browser?.close();
  await fixture.stop();
}
