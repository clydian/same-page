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

## 版本隔离与缓存缺失恢复

应用壳现使用 injectManifest 的独立版本缓存，名称为
`same-page-shell-v1:<编码scope>:<build>:<manifest摘要>`。该格式不匹配旧
Workbox 的 `-precache-` 与原始 scope 清理选择器；新 worker 不调用旧式通用
cache cleanup。`shell-manifest.json` 是构建审计产物，每项有精确 SHA-256、
字节数和revision。规范根路径 `/` 使用 index.html 的内容与revision，避免
把 `/index.html` 跟随307后的响应直接用于导航。

安装和激活检查完整清单，受损缓存按精确摘要修复；无法修复时只使用完整、
校验通过的保留版本，或返回可手动重试的页面。接口及OAuth仍直接到Worker，
缺失静态模块不转成HTML。保留版本和旧Workbox静态缓存可供尚在使用旧HTML的
页面取回带hash资产；不强刷读谱/编辑页面，不写业务IndexedDB。

只有本机制拥有的缓存参与回收。worker身份与页面版本探测保护active、waiting、
installing和在用版本；未知/挂起客户端否决回收。短Web Lock及安装租约防止回收
与重装同一版本竞争；缺少该API时保守不回收。额外保留一个完整rollback版本，
已激活版本有24小时历史/BFCache宽限。安装容量上限为四份7MiB清单；引用、宽限
或配额不足时暂停新安装，保留当前可用壳与既有waiting更新。此上限只约束应用壳，
不会以清谱面、笔记、草稿或待同步操作换取空间。旧Workbox缓存不自动删除，
避免迁移时破坏无法识别的旧客户端；退役旧worker后不再向它增长写入。

`test:pwa-update` 保留原自动重启/明确安全交接和动画回归，另验证旧共享缓存
A/B与新C交错时两种激活方式、完整manifest、真实Chromium配额失败及重试、
壳缺失恢复、API排除、Back、离线与重连。WebKit因不提供后台worker执行上下文，
最终C交接通过真实明确更新协议验证；自然后台激活由Chromium覆盖。桌面WebKit
不代表真实iOS/Safari/PWA验收。详见ADR-0020。
