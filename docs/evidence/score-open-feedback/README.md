# 列表内打开乐谱与按需连接说明

基线：`main@3ddac9ea505c736ad6b967b2cbca2fcea24aa597`。截图由本地真实应用、合成乐谱与合成登录用户生成；Chromium 156，390 × 844。没有使用真实用户数据，也没有修改截图内容。

| 场景 | 修改前 | 修改后 |
| --- | --- | --- |
| 未缓存 PDF 下载失败 | [整页错误](before-download-failure.png) | [留在列表，短提示](after-download-failure.png) |
| 浏览器离线 | [底部常驻说明](before-offline-list.png) | [精简列表](after-offline-list.png) |

[列表内加载与取消](after-loading.png) · [展开后的连接说明](after-connection-panel.png)。

下载失败截图使用仓库 `startStorageFixture` 启动真实 dev 应用，在 Playwright 中阻断 PDF 请求；该场景禁用 service worker，明确覆盖原先「无离线壳就直接进入阅读器」的分支。恢复请求后实际验证谱面绘制，不把出现阅读器外壳视为成功。

连接截图复用仓库 `startConnectionFixture`；环境代理无法访问 nip.io，因此仅将夹具的两个 HTTPS 地址改为本机不同端口，产品组件和服务端响应保持真实。已验证说明只在面板打开时出现，关闭后移除。

离线截图是在已加载目录后使用 `context.setOffline(true)`，不是把页面文案改成离线。缓存重启与权限撤销另外由现有 `offline-entry-smoke.test.mjs` 在生产构建上验证。

关键验证：

- 下载失败后 URL 和列表上下文保留；再次点击可成功打开。
- 请求延迟时仍显示加载；重复点击复用同一次打开；取消并释放迟到请求后不跳转，键盘焦点回到谱名。
- 从直接链接进入，下载失败仍由阅读器提供错误处理。
- 本机已校验副本可打开；浏览器重启后断网仍能从已保存目录进入；本机目录读取可重试；已确认失权不继续使用云端权限。
- 提示默认 8 秒，悬停或聚焦时保留，可主动关闭；组件回归覆盖取消、改选、卸载、session 与 PDF 版本变化。

长期测试复用既有组件、阅读器缓存和离线冒烟测试；临时截图脚本不作为另一套测试框架保留。截图反映本地夹具，Safari / iOS 真机尚未验证。
