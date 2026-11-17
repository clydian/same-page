# 统一产品管理员：界面证据

2026-11-17，在隔离本地 Worker / D1 / R2、Chromium 156（Playwright 1.64.1）、1440×1000 视口执行既有 `browser-tests/admin-workbench.test.mjs`。身份、邮箱、两个云盘和谱面均为测试生成，不含生产数据。

同一个 `product_administrators` 授权可见发布通道、乐谱工作台、问题反馈及操作记录；点击问题反馈能读取私有收件箱，返回乐谱后继续完成原 PDF 预览、XML 导入／检查／发布。该身份没有云盘成员关系，普通云盘 API 仍返回 403。没有修改页面布局或安全区。

- [乐谱工作台与完整导航](chromium-directory.png)
- [问题反馈收件箱与完整导航](chromium-reports.png)

复现：先 `npm ci && npm run build`，再 `node --test --test-name-pattern='chromium' browser-tests/admin-workbench.test.mjs`。完整浏览器测试在 CI 执行 Chromium / WebKit；此处截图为 Chromium，不代表真实 Safari/iPad 验收。

本地通过：完整 Worker 测试（4 个 unit 文件、19 个 integration 文件），后台客户端核心测试（3 文件、10 项），CLI（2 项）、lint、typecheck、build、Chromium 后台完整流程。迁移回归由 `npm run test:migrations` 和 PR CI 验证；名单变化、迁移顺序及回退见[运维说明](../../operations/product-admin.md)。
