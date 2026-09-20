import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, webkit } from "playwright";
await mkdir("artifacts/editor-preview", { recursive: true });
const engine = process.env.EDITOR_PREVIEW_ENGINE === "webkit" ? webkit : chromium;
const browser = await engine.launch({ headless: true });
try {
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on("pageerror", error => console.log("PAGE ERROR", error.message));
await page.goto("http://127.0.0.1:4176/choirs/visual-choir/scores/visual-score");
await page.locator(".annotated-pdf-page canvas:not([hidden])").first().waitFor();
if (await page.getByRole("button", { name: "知道了" }).isVisible()) await page.getByRole("button", { name: "知道了" }).click();
await page.locator(".annotated-pdf-page").first().click({ position: { x: 280, y: 300 } });
await page.getByRole("button", { name: "编辑", exact: true }).click();
await page.getByRole("button", { name: "荧光笔", exact: true }).click();
await page.getByRole("button", { name: "工具设置" }).click();
await page.getByRole("slider", { name: "荧光笔宽度" }).fill("32").catch(async () => { const slider=page.getByRole("slider", {name:"荧光笔宽度"}); await slider.focus(); await page.keyboard.press("Home"); for(let i=0;i<31;i++) await page.keyboard.press("ArrowRight"); });
await page.screenshot({ path: "artifacts/editor-preview/style.png" });
console.log(await page.locator("body").innerText());
await page.keyboard.press("Escape");
const beforeIds = await page.evaluate(async () => {
  const { localDatabase } = await import("/src/client/platform/local-database.ts");
  return (await localDatabase.annotations.toArray()).map(note => note.id);
});
const overlay = page.locator(".annotation-overlay svg").first();
const box = await overlay.boundingBox();
await page.mouse.move(box.x + box.width*.23, box.y + box.height*.32); await page.mouse.down();
for(let i=0;i<18;i++) await page.mouse.move(box.x+box.width*(.23+i*.02),box.y+box.height*(.32+Math.sin(i/3)*.007));
await page.mouse.up();
await page.waitForFunction(async beforeIds => {
  const { localDatabase } = await import("/src/client/platform/local-database.ts");
  return (await localDatabase.annotations.toArray()).some(note => !beforeIds.includes(note.id));
}, beforeIds);
const targetId = await page.evaluate(async beforeIds => {
  const { localDatabase } = await import("/src/client/platform/local-database.ts");
  return (await localDatabase.annotations.toArray()).find(note => !beforeIds.includes(note.id)).id;
}, beforeIds);
await page.getByRole("button",{name:"选择",exact:true}).click();
await page.mouse.click(box.x+box.width*.35,box.y+box.height*.32);
await page.getByRole("complementary",{name:"所选笔记属性"}).waitFor();
await page.screenshot({path:"artifacts/editor-preview/selection.png"});
for (const width of [320, 390, 834]) {
  await page.setViewportSize({ width, height: 844 });
  await page.waitForFunction(() => {
    const bar = document.querySelector(".annotation-object-properties").getBoundingClientRect();
    const tools = document.querySelector(".annotation-controls").getBoundingClientRect();
    return bar.left >= 0 && bar.right <= innerWidth && bar.top >= 0 && bar.bottom + 8 <= tools.top;
  });
  await page.screenshot({path: `artifacts/editor-preview/selection-${width}.png`});
}
await page.setViewportSize({width:390,height:844});
await page.screenshot({path:"artifacts/editor-preview/mobile.png"});
const readX = () => page.evaluate(async targetId => {
  const { localDatabase } = await import("/src/client/platform/local-database.ts");
  return (await localDatabase.annotations.toArray()).find(note => note.id === targetId).payload.points[0].x;
}, targetId);
const originalX = await readX();
const currentBounds = await overlay.boundingBox();
await page.keyboard.down("ArrowRight");
await page.keyboard.down("ArrowRight");
await page.keyboard.down("ArrowRight");
assert.equal(await readX(), originalX, "held keys preview without intermediate writes");
await page.keyboard.up("ArrowRight");
await page.waitForFunction(async ({ targetId, expected }) => {
  const { localDatabase } = await import("/src/client/platform/local-database.ts");
  const note = (await localDatabase.annotations.toArray()).find(note => note.id === targetId);
  return Math.abs(note.payload.points[0].x - expected) < .000001;
}, { targetId, expected: originalX + 3 / currentBounds.width });
await page.keyboard.press("Control+z");
await page.waitForFunction(async ({ targetId, originalX }) => {
  const { localDatabase } = await import("/src/client/platform/local-database.ts");
  return (await localDatabase.annotations.toArray()).find(note => note.id === targetId).payload.points[0].x === originalX;
}, { targetId, originalX });
const readNib = () => page.evaluate(async targetId => {
  const { localDatabase } = await import("/src/client/platform/local-database.ts");
  return (await localDatabase.annotations.toArray()).find(note => note.id === targetId).payload.nib;
}, targetId);
const originalNib = await readNib();
await page.getByRole("complementary", { name: "所选笔记属性" }).getByRole("button", { name: originalNib === "round" ? "扁头" : "圆头", exact: true }).click();
await page.waitForFunction(async ({ targetId, originalNib }) => {
  const { localDatabase } = await import("/src/client/platform/local-database.ts");
  return (await localDatabase.annotations.toArray()).find(note => note.id === targetId).payload.nib !== originalNib;
}, { targetId, originalNib });
await page.keyboard.press("Control+z");
await page.waitForFunction(async ({ targetId, originalNib }) => {
  const { localDatabase } = await import("/src/client/platform/local-database.ts");
  return (await localDatabase.annotations.toArray()).find(note => note.id === targetId).payload.nib === originalNib;
}, { targetId, originalNib });
const propertySlider = page.getByRole("complementary", { name: "所选笔记属性" }).locator(".annotation-style-slider").filter({ hasText: "不透明度" });
const track = await propertySlider.locator(".react-aria-SliderTrack").boundingBox();
const readOpacity = () => page.evaluate(async targetId => {
  const { localDatabase } = await import("/src/client/platform/local-database.ts");
  return (await localDatabase.annotations.toArray()).find(note => note.id === targetId)?.payload.opacity;
}, targetId);
await page.mouse.move(track.x + track.width * (30 - 5) / 95, track.y + 16);
await page.mouse.down();
await page.mouse.move(track.x + track.width * (65 - 5) / 95, track.y + 16, { steps: 8 });
assert.equal(await readOpacity(), .3, "drag previews without writing intermediate values");
await page.mouse.up();
await page.waitForFunction(async targetId => {
  const {localDatabase} = await import("/src/client/platform/local-database.ts");
  return (await localDatabase.annotations.toArray()).some(note => note.id === targetId && note.payload?.kind === "ink" && note.payload.opacity === .65);
}, targetId);
await page.getByRole("button", { name: "撤销", exact: true }).click();
await page.waitForFunction(async targetId => {
  const {localDatabase} = await import("/src/client/platform/local-database.ts");
  return (await localDatabase.annotations.toArray()).some(note => note.id === targetId && note.payload?.kind === "ink" && note.payload.opacity === .3);
}, targetId);
await page.getByRole("button", { name: "完成编辑", exact: true }).click();
await page.waitForFunction(async () => {
  const {localDatabase} = await import("/src/client/platform/local-database.ts");
  return (await localDatabase.annotationOutbox.count()) === 0;
});
await page.reload();
await page.locator("[data-ink-stroke]").waitFor();
assert.ok(await page.locator("[data-ink-stroke]").count() > 0);
console.log("Preview passed: style, drawing, selection, autosave, undo, completion and reload");
} finally { await browser.close(); }
