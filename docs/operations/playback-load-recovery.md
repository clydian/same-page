# 可选播放器加载失败与部署更新

对应 #446。旧页面可能一直保留旧版应用壳；播放器是按需下载的模块，且有意
不进入 PWA 预缓存。部署替换哈希文件后，旧页面首次打开播放器可能请求已经
不存在的旧模块。安全更新会保留仍在工作的页面，并允许其他窗口否决切换，
不能用自动刷新或清空站点数据处理这个失败。

播放器区域现在有独立错误边界。模块加载或播放器渲染失败会切回 PDF，保留
阅读器、笔记编辑器和全局更新监听。错误区显示更新检查结果，提供关闭播放器、
检查更新和关于合谱入口。检查只准备更新；完成当前操作后，用户仍通过关于
合谱的既有安全交接应用更新。其他窗口否决时继续保留当前版本。

`assets`、`pdfjs`、`font`、`soundfont` 四个静态资源目录通过 Worker 的 ASSETS
绑定读取。真实资源保留原字节、MIME 与缓存头；缺失响应或 SPA 回退 HTML
转换为 `404 + Cache-Control: no-store`，不再将 HTML 按模块 URL 缓存一年。
正常页面导航仍沿用 SPA fallback，API 路由不变。代价是这些目录的请求增加
一次 Worker 调用。没有增加旧构建资源托管，也没有扩大播放器预缓存。

已运行的旧客户端仍须按原更新流程切换后才能获得错误边界。这个补丁不能
热补已经加载的 JavaScript，也不能收回浏览器此前缓存的旧模块 URL 响应。

回归：`playback-gate.test.tsx` 拒绝实际 lazy import，确认未保存输入保持同一
DOM 和内容、回到 PDF、可见更新反馈及可关闭。`static-assets.test.js` 覆盖
HTML 回退、404 缓存头和真实文件透传。真实 Chromium/WebKit 的
`playback-load-failure.test.mjs` 从成员阅读器打开附件，注入相同 HTML/MIME
加载失败，确认 reader 根节点/PDF 未卸载、检查更新不导航，并通过实际本地
HTTP 验证四个目录的缺失资源和正常 SPA/脚本响应。桌面 WebKit 不代表真实
Safari/PWA 验收；原多窗口 PWA 更新测试继续保护交接策略。

部署后核对旧 `/assets/musicxml-player-BRJQwkJT.js` 返回 404/no-store，当前
build.json 中的脚本仍返回 JavaScript/immutable，再从成员附件入口实测播放。
不要通过清站点数据、强行激活 worker 或关闭其他使用中的窗口绕过安全策略。
