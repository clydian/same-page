# 分页阅读落笔进入现有编辑模式

源提交：clydian/same-page `24b828a`（#691）。834 × 800，中文，reduced-motion，独立浏览器 context，真实 ReaderPage / PDF / IndexedDB，API 使用 visual fixture。

- `pencil-entry-chromium-contact.png`：原生 CDP pen 按下后，同一 SVG 保持指针捕获；没有抬笔或点击编辑，现有工具栏已出现，画笔写入“我的笔记”。
- `pencil-entry-chromium-complete.png`：同一次接触移动后释放，点击完成，首笔留在第二页，恢复阅读。
- `pencil-entry-webkit-saved.png`：WebKit PointerEvent 首笔写入完成并刷新后的阅读画面。WebKit 测试使用模拟 PointerEvent，不代表真机 Apple Pencil 输入。

运行：`PENCIL_ENTRY_SCREENSHOT=1 node --test visual-report/pencil-entry.test.mjs`。

Cloud WebKit 使用临时下载并解包的 Debian 系统库，补入临时 Playwright runtime。其 dlopen 预检查不能识别临时 GLES 路径，设置 PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1 后实际启动并运行测试。产品和仓库依赖未更改。

这些截图展示自动进入与首笔保留，不证明 Apple Pencil 真机手感、延迟或压感质量。未做 iPad 真机测试。
