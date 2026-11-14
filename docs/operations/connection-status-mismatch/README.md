# #652 真实页面截图

本目录保留前一轮对照。最新无文字入口与括号状态的八种截图见 [states/README.md](states/README.md)。

这些是隔离测试环境的真实页面截图，**不是用户设备的故障实录**，也不是直接截取已部署应用壳。界面没有通过 DOM 注入改写，没有绘制或修改截图像素。

- 旧版产品源码：`04e6b270439f4f461832a22f4651147c41920c9e`。
- PR 版产品源码：`0a834924d75bacef65228c6f17ac516a484d56ad`，默认收起状态解释，保留离线入口标签和提示避让样式。
- Chromium 156，390 × 844；由本地 Worker / D1 / R2 提供合成用户、后台权限、云盘和更新目录。没有使用真实登录或用户文件。两个版本共用同样的测试 fixture 支持。
- Service Worker 被测试上下文禁用；这是页面内网络状态对照，不是离线应用壳冷启动验证。
- 先联网获取真实 health 响应，再用 `context.setOffline(true)` 实际断开浏览器网络。没有改写 navigator getter，也没有代答 health。
- 面板图将测试时钟停在最后成功采样约一秒后以对齐取景；拍完后恢复时钟。不能把这张图解读为“断网很久仍不断获得新的健康成功”。
- 菜单截图验证：联网时本地测试用户已通过实际后台权限请求；离线后重新开菜单不发该请求，入口消失。该用户的本地测试权限没有被移除。
- 通道截图验证：实际点击测试版，页面显示“当前离线，请联网后再切换版本”，没有发出通道选择 POST。更新目录为隔离 fixture 合成目录，不是生产发布目录。
- 菜单中的版本时间是从源码启动的开发构建信息，不能用于核对线上 sealed artifact 的版本。

| 文件 | 读图要点 |
| --- | --- |
| before-online-menu.png | 旧版联网菜单，存在“产品后台” |
| before-offline-menu.png | 同一旧版测试用户断网后：菜单没有“产品后台”，左下仍为 Wifi 图标，同时页面报告离线 |
| before-offline-panel.png | 旧版面板仍显示上一次“可连接”，采样时间约一秒前 |
| after-offline-panel.png | 同样条件下，PR 版默认只在当前线路旁显示浏览器离线，状态解释默认收起 |
| after-expanded-status-help.png | 点击或按 Enter 展开“状态与连接帮助”后才出现解释 |
| after-offline-entry.png | 关闭面板后，PR 版入口显示“浏览器离线”；原有页面离线提示放在其上方，不互相遮挡 |
| before-offline-channel.png | 旧版通道选择的离线前置门禁 |
| after-offline-channel.png | PR 版保留该门禁，不能从提示修复推断功能已经恢复 |

`before-capture.json` 与 `after-capture.json` 保存来源和条件，不包含 Cookie、凭证或真实用户内容。

在选定源码 worktree 中复现：

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/local-chromium \
  node /path/to/pr-worktree/scripts/capture-connection-status.mjs \
  before /absolute/path/to/screenshots
```

PR worktree 使用 `after`。旧源码 worktree 只需共用 PR 版本的两个测试 fixture 文件，以启用合成后台与更新目录；不替换产品源码。测试主机应只解析到 127.0.0.1，浏览器仅忽略本地合成 HTTPS 证书。

完整状态与触发条件见 [states.md](states.md)。当前默认面板没有新增的两段长说明；具体身份冲突与恢复操作仍按原条件可见。
