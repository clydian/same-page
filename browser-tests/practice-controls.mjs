import { expect } from '@playwright/test';

export async function selectPracticeView(page, name) {
  await page.getByRole('button', { name: '显示谱面', exact: true }).click();
  await page.locator('.practice-view-option').filter({ hasText: name }).click();
  await expect(page.getByRole('button', { name: '显示谱面', exact: true })).toHaveText(name);
}
export async function changeNotationSize(page, operation, count = 1) {
  if (operation === '恢复默认谱面大小') await page.getByRole('button', { name: '谱面大小', exact: true }).click();
  else for (let i = 0; i < count; i++) await page.getByRole('button', { name: operation, exact: true }).click();
}

export async function draftLoopRange(page, start, end) {
  const editor=page.getByRole('region',{name:'片段循环',exact:true});
  const begin=editor.getByRole('button',{name:/^(选择循环片段|调整范围)$/});
  if(await begin.count()) await begin.click();
  const from=editor.getByRole('slider',{name:/^循环起点/}),to=editor.getByRole('slider',{name:/^循环终点/});
  if(start>Number(await to.inputValue())) {await to.fill(String(end));await from.fill(String(start));}
  else {await from.fill(String(start));await to.fill(String(end));}
  await expect(from).toHaveValue(String(start));await expect(to).toHaveValue(String(end));
}
