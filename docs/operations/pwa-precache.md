# PWA 预缓存预算与首页动画

对应 #410，源码基线 `8651210`。

应用壳预缓存供离线冷启动使用。主 PDF 引擎、PDF Worker、WASM 与 JavaScript
解码器、字体、入口、图标及首页静态插画继续进入预缓存。首页四段介绍动画是
可选资源，发布到带内容哈希的 `assets/*-animation-*.webp`，只在进入视口或
用户主动播放时请求。减少动态效果设置下不自动请求；请求或动画解码失败时
继续显示静态插画。

`vite.config.ts` 将 shared-layers、personal-layer、replace-pdf、offline-sync
四种动画从预缓存 glob 排除，并注册同源且限于这四种文件名的 CacheFirst
路由。运行时缓存 `same-page-home-animations` 只接收状态 200、Content-Type
为 `image/webp` 的响应，最多保留 8 项，最长 30 天；条目限制容纳两轮完整动画，
过期及淘汰由 Workbox 在缓存访问时处理。不会主动预取或保证所有演示离线可用。
带哈希的新 URL 独立获取；已有缓存可以供再次播放及离线重播使用。

## 构建门禁

`npm run build` 调用 `scripts/verify-precache.mjs`，按生成后预缓存清单中每个
唯一 URL 文件的实际磁盘字节数求和。同一图标同时被 includeAssets 和 glob
收集时只计一次，与 Workbox 实际存储行为一致。预算为 7 MiB（7,340,032 字节），包括全部预缓存
条目，不是网络压缩传输量或运行时缓存上限。超限、动画误入预缓存、静态插画
或 PDF 必需资源遗漏均使构建失败。现有
`artifacts/verification/precache-136.json` 报告增加 `budgetBytes`，当前统计标记为
`unique-urls`。历史基线保留并标记为 `manifest-records`，移除不再同口径的
`deltaEntries` / `deltaBytes`；仓库没有这些字段的运行时消费者。
升级 PDF.js 或新增离线资源若超预算，应先核查必要性，再明确评审
预算调整；不要移除离线必需依赖来通过门禁。

基线原始清单报告为 119 项、10,111,786 字节，其中五个图标重复计入；按唯一
URL 计算为 114 项、9,751,694 字节。四段动画合计 3,257,728 字节。
移除动画后为 110 项、约 6.49 MB，预算留下约 0.85 MB 的增长空间；最终数值以对应源码
构建报告为准，合成 PWA 构建的标识与正式源码 SHA 不同。

## 验证与更新

Node 审计回归保护必需资源、静态插画、可选动画和总字节预算。现有
`npm run test:pwa-update` 的真实 Service Worker 测试增加 Chromium/WebKit
首页场景：安装及减少动态效果不请求动画、进入视口才下载、运行时缓存离线
重播、未缓存及 503 请求回退静态插画、失败后联网重试。它补齐构建清单无法
验证的实际网络和离线行为；不重复测试 Workbox 的内部淘汰算法。

更新交接沿用已有机制：不强制刷新在用页面，新 worker 准备好后通过正常退出
或用户明确请求切换。Workbox 激活时会清理不再属于新预缓存清单的旧动画条目。
运行时缓存独立、有界；不迁移数据库、IndexedDB、草稿、待同步操作或冲突。
既有双版本更新、离线 PDF smoke 和完整 `check:full` 继续作为发布门禁；桌面
浏览器验证不代表 iPad/Pencil 或真实 Safari 验收。

发布前完整验证暴露了既有测试进程清理的 macOS 退出竞态：终止后进程组存在性
探针 `kill(-pgid, 0)` 偶发返回 `EPERM`，导致产品断言已通过的 smoke 在清理
hook 失败。Apple XNU 的进程组信号路径过滤 zombie，组仍注册但没有可发信号
的成员时会返回 `EPERM`，见 [内核实现](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_sig.c#L1612)。
`scripts/process-lifecycle.mjs` 现在把零信号探针的 `EPERM` 保守视为尚未消失，
继续原有有界等待；真正的 SIGTERM / SIGKILL 权限拒绝仍然抛错，不降级为清理
成功。新增回归以真实独立进程注入终止后的一次探针拒绝，并另行验证真实终止
信号拒绝继续失败。该辅助修复不进入生产 Worker，也不放宽浏览器行为断言。
