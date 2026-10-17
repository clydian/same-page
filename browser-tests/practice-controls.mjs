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
