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

export async function setLoopRange(page, start, end) {
  const editor=page.getByRole('region',{name:'片段循环',exact:true});
  if (!(await editor.getByRole('switch',{name:'片段循环',exact:true}).isChecked())) await editor.getByRole('switch',{name:'片段循环',exact:true}).locator('xpath=ancestor::label').click();
  const from=editor.getByRole('slider',{name:/^循环起点/}),to=editor.getByRole('slider',{name:/^循环终点/});
  const set=async (input,value)=>{await input.fill(String(value));await input.dispatchEvent('pointerup');};
  if(start>Number(await to.inputValue())) {await set(to,end);await set(from,start);}
  else {await set(from,start);await set(to,end);}
  await expect(from).toHaveValue(String(start));await expect(to).toHaveValue(String(end));
}
