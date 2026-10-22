export async function chooseLibrarySort(page, sort) {
  await page.getByRole("button", { name: /^按.*排序/ }).click();
  await page.getByRole("dialog", { name: "乐谱排序" }).getByText({ name: "名称", updated: "最近更新", opened: "本机最近打开" }[sort], { exact: true }).click();
  await page.keyboard.press("Escape");
}

export async function refreshLibrary(page) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator(".pull-refresh-area").evaluate(element => {
    for (const [type, touches] of [
      ["touchstart", [{ clientX: 50, clientY: 20 }]],
      ["touchmove", [{ clientX: 50, clientY: 160 }]],
      ["touchend", []],
    ]) {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, "touches", { value: touches });
      element.dispatchEvent(event);
    }
  });
}
