import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { test } from "node:test";
import { chromium, webkit, expect } from "@playwright/test";
import { startVisualServer } from "./setup.mjs";
import { createVisualFixtureSession } from "./fixtures.mjs";

// Actual React route, PDF canvas, IndexedDB and conflict resolver. The score,
// identities, API and conflict response are synthetic; no production data.
test("conflicts compare in place and require confirmation in Chromium and WebKit", async t => {
  const app = await startVisualServer({ script: "dev" });
  t.after(() => app.stop());
  await mkdir("artifacts/verification/note-conflict", { recursive: true });
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch();
    try {
      for (const width of [834, 390]) {
        const context = await browser.newContext({ viewport: { width, height: width === 834 ? 1100 : 844 }, serviceWorkers: "block", reducedMotion: "reduce" });
        try {
          await context.addInitScript(() => {
            localStorage.setItem("reader-gesture-hint-seen", "true");
            window.fixtureOnline = true;
            Object.defineProperty(navigator, "onLine", { get: () => window.fixtureOnline });
          });
          const fixture = createVisualFixtureSession();
          let cloud = null;
          await context.route("**/api/**", async route => {
            const request = route.request();
            const pathname = new URL(request.url()).pathname;
            const response = fixture.resolve({ pathname, method: request.method(), identity: "member", scenarioId: "reader-conflicts", cookie: "" });
            if (pathname.endsWith("/sync") && cloud) {
              const body = JSON.parse(response.body);
              body.annotations.objects = body.annotations.objects.filter(note => note.id !== cloud.id).concat(cloud);
              body.annotations.cursor = cloud.version;
              return route.fulfill({ ...response, body: JSON.stringify(body) });
            }
            return route.fulfill(response);
          });
          const page = await context.newPage();
          const errors = [];
          page.on("pageerror", error => errors.push(error.message));
          await page.goto(`${app.origin}/choirs/visual-choir/scores/visual-score`);
          await page.locator("[data-page-turn-current] [data-pdf-canvas-active]").waitFor();
          cloud = await seedConflict(page);
          await page.getByRole("button", { name: "查看", exact: true }).click();
          const dialog = page.getByRole("dialog", { name: "比较冲突笔记" });
          await dialog.getByText("已核对云端", { exact: true }).waitFor();
          await dialog.locator("[data-pdf-canvas-active]").waitFor();
          await dialog.getByRole("button", { name: "确认选择", exact: true }).scrollIntoViewIfNeeded();
          await expect(dialog.getByRole("button", { name: "确认选择", exact: true })).toBeDisabled();
          assert.equal(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth), true, "dialog content overflows horizontally");
          const bounds = await dialog.boundingBox();
          assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width, "dialog is outside viewport");
          const viewport = dialog.locator(".conflict-viewport");
          await viewport.evaluate(element => { element.scrollTop += 12; element.scrollLeft += 12; });
          const before = await geometry(viewport);
          const canvas = await dialog.locator("[data-pdf-canvas-active]").elementHandle();
          await dialog.getByRole("button", { name: /云端版本 · 第 1 页/ }).click();
          await expect(dialog.locator(".conflict-paper .annotation-text").filter({ hasText: "渐强，统一打开元音" })).toBeVisible();
          assert.deepEqual(await geometry(viewport), before, "switching variants moved the score viewport");
          assert.equal(await canvas.evaluate(node => node === document.querySelector('.conflict-paper [data-pdf-canvas-active]')), true);
          await expect(dialog.locator(".conflict-paper > .annotation-overlay .annotation-text")).toBeInViewport();
          if (engine === chromium) {
            await dialog.evaluate(element => { element.scrollTop = 0; });
            await page.screenshot({ path: `artifacts/verification/note-conflict/${width}-cloud.png` });
            await dialog.screenshot({ path: `artifacts/verification/note-conflict/${width}-cloud-panel.png` });
            await dialog.getByRole("button", { name: /本机修改 · 第 1 页/ }).click();
            await page.screenshot({ path: `artifacts/verification/note-conflict/${width}-local.png` });
            await dialog.screenshot({ path: `artifacts/verification/note-conflict/${width}-local-panel.png` });
          }
          // Preview never decides. Selecting and opening confirmation also does
          // not remove the conflict; failed saves remain retryable.
          await dialog.getByText("采用云端版本", { exact: true }).click();
          await dialog.getByRole("button", { name: "确认选择", exact: true }).click();
          assert.equal(await conflictCount(page), 1);
          // An independent local edit arriving during review invalidates it.
          await page.evaluate(async () => {
            const { localDatabase } = await import('/src/client/platform/local-database.ts');
            const { saveAnnotationDraft } = await import('/src/client/annotations/annotation-state.ts');
            const conflict = (await localDatabase.annotationConflicts.toArray())[0];
            await saveAnnotationDraft(conflict, { id: conflict.annotationId, layerId: conflict.layerId, payload: { ...conflict.localPayload, text: "本机继续修改" } });
          });
          await expect(dialog.getByRole("button", { name: "确认处理", exact: true })).toHaveCount(0);
          await expect(dialog.getByRole("button", { name: "确认选择", exact: true })).toBeDisabled();
          await dialog.getByRole("button", { name: "关闭笔记比较" }).click();
          await expect(page.getByRole("button", { name: "查看", exact: true })).toBeFocused();
          assert.equal(await conflictCount(page), 1);
          // Deletion, offline review, cross-page and absent-page labels use the
          // same production panel; no invalid keep-both action is offered.
          await page.evaluate(async () => {
            window.fixtureOnline = false; window.dispatchEvent(new Event('offline'));
            const { localDatabase } = await import('/src/client/platform/local-database.ts');
            const { saveAnnotationDraft } = await import('/src/client/annotations/annotation-state.ts');
            const conflict = (await localDatabase.annotationConflicts.toArray())[0];
            await saveAnnotationDraft(conflict, { id: conflict.annotationId, layerId: conflict.layerId, payload: null, deleted: true });
          });
          await page.getByRole("button", { name: "查看", exact: true }).click();
          await dialog.getByText("本机已删除这条笔记", { exact: true }).waitFor();
          await expect(dialog.getByRole("radio", { name: "两份都保留" })).toHaveCount(0);
          await dialog.getByRole("button", { name: "稍后处理", exact: true }).click();
          for (const kind of ['pen', 'highlighter', 'shape']) {
            await page.evaluate(async kind => {
              const { localDatabase } = await import('/src/client/platform/local-database.ts');
              const { saveAnnotationDraft } = await import('/src/client/annotations/annotation-state.ts');
              const conflict = (await localDatabase.annotationConflicts.toArray())[0];
              const payload = kind === 'shape' ? { kind: 'shape', shape: 'ellipse', pageNumber: 1, x: .4, y: .5, width: .2, height: .06, strokeWidth: .004 }
                : { kind: 'ink', brush: kind, nib: 'round', pressureMode: 'uniform', pageNumber: 1, points: [{ x: .4, y: .53 }, { x: .6, y: .53 }], strokeWidth: .012 };
              await saveAnnotationDraft(conflict, { id: conflict.annotationId, layerId: conflict.layerId, payload });
            }, kind);
            await page.getByRole('button', { name: '查看', exact: true }).click();
            await dialog.locator(kind === 'shape' ? '.conflict-paper > .annotation-overlay ellipse' : '.conflict-paper > .annotation-overlay [data-ink-stroke]').waitFor();
            await dialog.getByText(kind === 'shape' ? '椭圆笔记' : kind === 'pen' ? '画笔笔记' : '荧光笔笔记', { exact: true }).waitFor();
            await dialog.getByRole('button', { name: '稍后处理', exact: true }).click();
          }
          await page.evaluate(async () => {
            const { localDatabase } = await import('/src/client/platform/local-database.ts');
            const { saveAnnotationDraft } = await import('/src/client/annotations/annotation-state.ts');
            const conflict = (await localDatabase.annotationConflicts.toArray())[0];
            await saveAnnotationDraft(conflict, { id: conflict.annotationId, layerId: conflict.layerId, payload: { ...conflict.canonical.payload, text: "跨页笔记", pageNumber: 2 } });
          });
          await page.getByRole("button", { name: "查看", exact: true }).click();
          await dialog.getByRole("button", { name: "本机修改 · 第 2 页", exact: true }).waitFor();
          await dialog.locator('.conflict-paper [data-page-number="2"] [data-pdf-canvas-active]').waitFor();
          await dialog.getByRole("button", { name: "云端版本 · 第 1 页", exact: true }).click();
          await dialog.locator('.conflict-paper [data-page-number="1"] [data-pdf-canvas-active]').waitFor();
          await page.evaluate(async () => {
            const { localDatabase } = await import('/src/client/platform/local-database.ts');
            const { saveAnnotationDraft } = await import('/src/client/annotations/annotation-state.ts');
            const conflict = (await localDatabase.annotationConflicts.toArray())[0];
            await saveAnnotationDraft(conflict, { id: conflict.annotationId, layerId: conflict.layerId, payload: { ...conflict.localPayload, pageNumber: 9 } });
          });
          await dialog.getByText("当前 PDF 没有第 9 页，无法显示原谱位置。", { exact: true }).waitFor();
          await dialog.getByText("采用云端版本", { exact: true }).click();
          await dialog.getByRole("button", { name: "确认选择", exact: true }).click();
          await dialog.getByRole("button", { name: "确认处理", exact: true }).click();
          await dialog.getByText("这份乐谱的本机冲突已处理。", { exact: true }).waitFor();
          assert.equal(await conflictCount(page), 0);
          assert.deepEqual(errors, []);
          assert.deepEqual(fixture.diagnostics.unmatchedRequests, []);
        } finally { await context.close(); }
      }
    } finally { await browser.close(); }
  }
});

async function seedConflict(page) {
  return page.evaluate(async () => {
    window.fixtureOnline = false; window.dispatchEvent(new Event('offline'));
    const { localDatabase } = await import('/src/client/platform/local-database.ts');
    const { saveAnnotationDraft, queueScoreDrafts, applyPushResults } = await import('/src/client/annotations/annotation-state.ts');
    const { createLocalWorkspace, captureLocalWorkspaceSession } = await import('/src/client/platform/local-workspace.ts');
    const original = await localDatabase.annotations.get(JSON.stringify([JSON.stringify(['user:visual-user-member','visual-choir','visual-score']), '10000000-0000-4000-8000-000000000002']));
    if (!original) throw new Error('fixture personal note missing');
    const workspace = await captureLocalWorkspaceSession(createLocalWorkspace(original.ownerKey, original.choirId, original.scoreId));
    await saveAnnotationDraft(workspace, { id: original.id, layerId: original.layerId, payload: { ...original.payload, x: .48, y: .52, text: "轻唱，收尾保持气息" } });
    await queueScoreDrafts(workspace);
    const operations = await localDatabase.annotationOutbox.where('scopeKey').equals(workspace.scopeKey).toArray();
    const cloud = { id: original.id, layerId: original.layerId, version: 2, deleted: false, payload: { ...original.payload, x: .54, y: .59, text: "渐强，统一打开元音" }, createdByDisplayName: '周宁', updatedByDisplayName: '周宁', updatedAt: Date.now() };
    await applyPushResults(workspace, operations, [{ opId: operations[0].opId, status: 'conflict', object: cloud }]);
    window.fixtureOnline = true; window.dispatchEvent(new Event('online'));
    return cloud;
  });
}
async function geometry(locator) {
  return locator.evaluate(element => ({ left: element.scrollLeft, top: element.scrollTop, width: element.scrollWidth, height: element.scrollHeight }));
}
async function conflictCount(page) {
  return page.evaluate(async () => (await import('/src/client/platform/local-database.ts')).localDatabase.annotationConflicts.count());
}
