# 浏览器门禁精简 · 2026-10-28

基线是 [PR #598 CI 40509013395](https://github.com/clydian/same-page/actions/runs/40509013395)，
以及合并 #599 后的连接采样场景。结果是一次运行，不是长期均值。

## 实测瓶颈与预计变化

| 项目 | 原运行观测 | 新安排 |
| --- | --- | --- |
| PR 关键路径 | 约 12 分 58 秒：13:05:27 启动，13:18:25 verify；构建 1 分 10 秒，visual 最慢 5 分 57 秒，smoke 4 片限并发 2，最后一片 13:18:21 结束 | 产品变更 visual 2 片、smoke 2 片，各全并行；verify 不等待扩展工作流。实际时长以新 PR 为准。 |
| 浏览器 runner | visual 4 + smoke 4；visual job 约 18.3 runner 分钟，smoke 约 22.4 runner 分钟，合约 40.6 分钟，不含其他 jobs | 普通产品 PR 与 main 各 4 个浏览器 runner；成功发布后扩展再用 4 个，不额外重复整个核心组。扩展工作流多两个轻量 plan/report runner；修改分层工具的 PR 另跑扩展来验证它。总成本受运行频率和环境影响，以真实结果为准。 |
| smoke 分片估算 | 使用现有取整耗时表，删去旧文件后全套四片约 345/345/335/330 秒；旧运行的四片实际用时约 334/237/294/210 秒（测试步骤） | 核心两片估算各 230 秒；扩展两片估算约 450/445 秒。表是单轮成本模型，不是 CI 实测或超时保证。 |

以前后的切分降低 PR 及发布前等待，并避免每个 PR 和 main 都跑一次所有扩展组合。
每个测试版发布后仍执行扩展，所以整体工作流及 runner 成本不是归零；测试基础设施
改动的 PR 会额外运行扩展工作流。若扩展耗时或失败率仍高，应按本记录进一步处理，
而不是靠增加分片、重试或延长时限隐藏。

对照首次调整后的 [PR CI 40540307919](https://github.com/clydian/same-page/actions/runs/40540307919)：
从 scope 开始到 verify 完成约 5 分 56 秒；四个浏览器门禁 job 共 14 分 22 秒，所有 CI job
共约 28 分 37 秒。旧 CI 同口径分别约 12 分 58 秒、40 分 38 秒和 52 分 16 秒。
这是各一次运行，受 runner 排队和环境影响；扩展工作流的成本另计。

## 保留在发布前

`browser-tests` 的核心组保留 access、annotations、attachments、connections、free-trial、
install-onboarding、invite-entry、musicxml-offline、offline-entry、outbox、PDF 替换/回收、
preview-notes、release-channel-navigation 和 storage。它们覆盖实际 Worker、D1/R2、
会话/权限、真实写入、离线重开、用户身份隔离、笔记和发布通道。`worker` 的权限、
同步、迁移测试、真实封存存储兼容矩阵、PWA 交接及部署准入不后移。

视觉核心保留 auth-methods、continuous-page-editing、drive-entry、drive-library-lifecycle、
fixtures 的未知请求拒绝、highlighter-regression、offline-library、pdf-export、
reader-annotation-stability、reader-conflicts、reader-immersive、reader-mobile-editing、
responsive-navigation、shared-layer-management 和 update-safety。新文件默认必跑；
library 范围取其核心交集。核心组是代表性保障，不宣称覆盖所有尺寸、手势和引擎状态。

## 移到发布后

31 个视觉文件：continuous-reader-layout、diagnostics、drive-context-attachments、
drive-navigation-settings、drive-navigation、drive-settings、experience-continuity、
highlighter-nib、invite-feedback、layer-panel-layout、layer-preferences、navigation-freshness、
pdf-share、pencil-writing、practice-focus、reader-canvas-layering、reader-experience、
reader-navigation、reader-presentation、reader-render-recovery、reader-scrubber、
reader-settlement、reader-status、reader-text-layout、reader-ux、reader-zoom、reading-state、
safe-area、ui-simplification、uiux-return、upload-queue。这里保留复杂导航、不同尺寸、
触控、排版和诊断的实际浏览器反馈；失败不阻止测试版，但在后台显示并需调查。

20 个真实 Worker 浏览器文件：admin-workbench、connection-sampling、diagnostic-reports、
file-touch-links、invite-connection-failover、loading-stability、musicxml-audio-startup、
musicxml-cursor-overflow、musicxml-native-selection、musicxml-playback、musicxml-startup、
pdf-codecs-smoke、playback-load-failure、playback-ux、practice-compare、practice-loop、
practice-reader-layout、practice-rhythm、practice-score-entry、practice-unified-controls。
例如旧邀请码故障注入双引擎约 106 秒、云盘导航双引擎约 150 秒；已保留常规邀请、
连接切换、离线原谱、写入与权限的更小主链。新 #599 的 connection-sampling 保留在
扩展组，不回滚其实现或删除专有回归。代价是这些详细播放器、界面和异常组合可能
在测试版发布后才发现；人手实际体验不等同自动验证通过。

## 删除或缩短

| 删除/缩短 | 剩余保障与明确代价 |
| --- | --- |
| `practice-measure-labels.test.mjs` 双引擎 | 播放器包的 `playback-measures` 测量反复标记，`playback-timeline` 组件与 `practice-reader-layout` 保留控件/标签连线；删除了单独的第二次反复经过点击端到端断言。 |
| `practice-settings.test.mjs` 双引擎 | `practice-setting` 组件、`playback-ux` 的混音/关注与 `practice-loop` 的循环操作保留；删除同一弹层三视口截图、列对齐等细节矩阵，以及部分说明弹窗端到端覆盖。 |
| `homepage-responsive.test.mjs` 双引擎 | `responsive-navigation` 保留小屏主要入口；删除产品介绍页多宽度和 200% 文字的专门几何矩阵，放弃该独立自动化保障。 |
| `playback-measure-labels.node.test.ts` | 与播放器包 `playback-measures.test.mjs` 的同一导出与样本重复。 |
| `fixtures.test.mjs` 中固定 fixture 自校验；历史假耗时分片测试 | 前者不验证产品行为，保留未知请求失败关闭；后者依赖旧 CI 时长且重复模拟调度。保留真实 runner 的无遗漏/无重复验证。 |
| `highlighter-regression` 四轮同场景往返改为一轮 | 两引擎、两种笔迹（含预算降级）、页面往返及错误断言保留；去除常态截图和同状态重复三轮。 |
| `home-entry.test.tsx` 的默认入口和返回历史用例 | 原用例在已跳转到正确路由后仍等待云盘独立加载，实测会在默认 1 秒内偶发超时；改为等待目标路由后验证返回历史，保留跳转和 replace 行为。云盘加载由其他场景验证。 |

视觉目录从 47 个文件到 46（其中 15 核心、31 扩展）；smoke 从 37 到 35（15 核心、
20 扩展）。数量不等同用例数或节省时间，且本次 #599 新增的 sampling 已计入。


## 2026-11-07：移除卸载时序的发布通道 browser case

[#589 合并后的失败运行](https://github.com/clydian/same-page/actions/runs/42235180463/job/127951555849)
中，`release-channel-navigation` 已进入产品后台，但最后的全局 `pageerror` 断言收到
WebKit 的 `Context is stopped`。该测试把真实 `CacheStorage.open` 的结果扣留到
`beforeunload` 才释放，强迫后续 receipt 读取、在线结果处理和写入与文档销毁竞争。

使用同一 `release-channel.ts` bundle、合成 localhost API 和 WebKit 27.2 做隔离对照：
扣留至卸载时 20 次中 18 次出现同一错误；保留诊断 instrumentation、但不扣留并立即硬导航时 20 次中 1 次；
先完成 reconciliation 再导航时 20 次中 0 次。进一步跟踪显示 `Response.json` 和
`Cache.put` 都已返回后才收到错误；提前构造 Response 的对照仍出现同一错误。
仅在诊断 harness 中替换后续原生 `Cache.match` / `Cache.put`、保留相同卸载时序时，
20 次中 0 次出现错误，定位到旧文档的 Cache API 关闭路径。WebKit 的
[`DOMCache`](https://github.com/WebKit/WebKit/blob/ff29931b0c9cd2db17ca61e807cd0b22256eb80d/Source/WebCore/Modules/cache/DOMCache.cpp)
会在操作期间文档停止时返回 `Error::Stopped`，
[`DOMCacheEngine`](https://github.com/WebKit/WebKit/blob/ff29931b0c9cd2db17ca61e807cd0b22256eb80d/Source/WebCore/Modules/cache/DOMCacheEngine.cpp)
将其转换为 `Context is stopped`。这个对照定位的是旧文档卸载竞争，
不是 `@types/node` 的运行时变化，也不是新页面无法打开的证据；次数仅为本次诊断，
不作为未来失败率估算，也不宣称本改动消除了生产代码的卸载竞争。

删除该双引擎 browser case 和分片成本条目，不加入重试、延时、错误白名单或
生产代码的卸载特判。它没有断言 release readback 的结果或持久化权限，且禁用了
service worker；用全局「没有旧文档错误」代表发布正确性，成本高于有效保障。
本条修正上文 10 月 28 日对该文件的核心组分类，其余历史统计保持原样。

保留并加强 `release-permission.node.test.ts` 的确定性测试：receipt 尚未可读时已发起
一次在线读取，释放存储后返回并保存服务端确认目标；读取先失败时仍保留离线版本
归属和原有 receipt。`verify-release-channels.mjs` 的 Chromium/WebKit 实际 service
worker 激活、跨窗口否决、Cookie 到期恢复和过期 beta 拒绝继续保留。明确放弃的是
文档销毁边界的零错误诊断断言，不是通道权限、离线数据或新页面可用性保障。
