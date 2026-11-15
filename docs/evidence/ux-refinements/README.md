# 阅读器与云盘入口收敛 · 2026-11-15

改前为 main `a7d7a7a`，改后为本 PR 的真实运行界面。全部使用仓库合成 PDF、MusicXML、身份与附件；无生产数据。PNG 原图用于 PR 前后对照，未画成“已实现”的概念图。

| 对照文件 | 场景 |
| --- | --- |
| before/after-reader-small.png | 320×568、40 页、工具展开；练习入口避让缩略条 |
| before/after-reader-landscape.png | 844×390、同一 40 页样本 |
| before/after-dismiss.png | 390×844、向下拖动 160px 未松手 |
| before/after-create.png | 390×844、创建表单独立入口 |
| before/after-picker.png | 390×844、仅一个成员云盘 |
| before/after-library.png | 390×844、已加入云盘的安装建议 |
| after-attachment-toast.png | 点击离线不可打开附件后，复用底部短暂可关闭提示 |

## 验证

- `npm run lint`、`npm run typecheck`、`npm run build`。
- `npm run test:ci`：31 项；Node 单元测试：381 项；组件测试：1452 项。
- Chromium / WebKit：`reader-drive-ux`、`drive-navigation-settings`、`offline-library`，7 项浏览器测试通过；补充冷目录在按住“创建”期间完成读取的场景，两个引擎均通过。
- 新增回归限于真实边界：外链局部长按、reduced motion、长谱避让、首次懒加载面板的 Escape / 焦点，以及冷目录读回时保持按住目标。离线附件沿用现有组件和浏览器场景，补充关闭提示断言。
- 自审检查手势所有权、短拖释放、多指接管、系统取消、减少动态效果、真实 href 与键盘/右键语义、按住时的目录高度、离线提示生命周期。未改变存储格式、权限或更新通道。

本地 Chromium 156 / WebKit 27.2。环境所缺浏览器库从已签名 Debian 索引下载，仅解包至 `/tmp` 并补入本地下载的浏览器运行目录；未改系统或项目依赖。首次缺库启动失败不算产品测试结果，补齐后真实执行双引擎。

手机尺寸是浏览器触摸模拟。iOS / Android 原生菜单、主屏幕 PWA、软键盘、读屏和低端机帧率仍需真机验收。局部长按策略不承诺阻止所有系统菜单；减少动态效果保留返回文字反馈。

未合并、部署或提升稳定版；稳定版更新暂停的要求不变。
