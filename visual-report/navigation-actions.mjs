export async function chooseLibrarySort(page, sort) {
  await page.getByRole("button", { name: /^按.*排序/ }).click();
  await page.getByRole("dialog", { name: "乐谱排序" }).getByText({ name: "名称", updated: "最近更新", opened: "本机最近打开" }[sort], { exact: true }).click();
  await page.keyboard.press("Escape");
}

export async function refreshLibrary(page) {
  await page.getByRole("button", { name: /^(我的|访客选项)$/ }).click();
  await page.getByRole("menuitem", { name: "刷新列表", exact: true }).click();
}
