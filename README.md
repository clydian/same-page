# MusicXML 系统跟随 · 本地浏览器验收

基线：clydian/same-page `05b2951748119544426f4417a0a6da0f2c1ce370`。390×640 窄屏模拟，Chromium 156、WebKit 27.2（Linux Playwright，非 iPhone/iPad 真机）。使用自制四声部、双行 la 歌词、全音符/四分音符交替的 32 小节 MusicXML，80 BPM、1.00×。所有图片均亲自打开检查；视频来自 Playwright recordVideo，再用 ffmpeg 裁剪、并排与加标签，没有用静态截图冒充视频。无声音。

[10 秒瞬跳 / 120ms ease-out 实播对照](review/instant-vs-120ms.mp4) · [最终即时版本](review/final.mp4) · [原主线](review/before.mp4) · [120ms 候选](review/candidate.mp4)。MP4 为 H.264/yuv420p、faststart。GitHub 预览若不播放，可下载或打开 raw 链接。

## 实测与选择

- 原主线：第 1 小节（系统 0）scrollTop=0；同系统第 2 小节变为 72。该系统本身完全可见，下一系统底部超出 531px 谱面视口。首小节 state.measure 已为 0，未进入“measure 或 tempo 改变”分支；第二小节进入后，旧 `nextBottom` 判断才推动当前系统。这是可重现路径，不声称所有迟滚动都来自同一原因。
- 最终：第 1/2 小节均为 0；进入系统 1 的第 3 小节仅一次变为 343，第 4 小节保持 343。Chromium 与 WebKit 的 rAF 轨迹均只有 `0 → 343`。WebKit 字体度量不同，系统 1 含第 3/4/5 小节，说明判断依赖实际系统而非固定小节数量。
- 两个方案同段、同速、同 viewport 对比。120ms 候选即使沿用最终的工具栏旧游标防护，仍因当前游标的边界避让而先到终点、再被动画拉回中间：`3 → 343 → 215 → 275 → 313 → 333 → 341 → 343`（约 115ms 内）。当前架构下即时到位更稳定，最终没有动画，没有新设置/框架；不因此断言经过两层统一调度后动画永远不可行。
- 原主线还有独立竞态：新 measure 已发布，bar cursor 尚在旧系统，工具栏避让读取旧矩形，把新跟随位置拉回一次。最终等待新 cursor 的 style mutation，避免这次反向纠正。没有改音频时钟或扩大播放器 state。

| 场景 | 真实截图 |
|---|---|
| 原第 1 / 2 小节，说明同系统迟移 | [1](review/before-chromium/measure-1.png) · [2](review/before-chromium/measure-2.png) |
| 最终第 1 / 2 小节，保持原阅读位置 | [1](review/final-chromium/measure-1.png) · [2](review/final-chromium/measure-2.png) |
| 最终新系统第 1 / 2 小节（印刷 3 / 4），位置相同 | [3](review/final-chromium/measure-3.png) · [4](review/final-chromium/measure-4.png) |
| WebKit 同段新系统 | [3](review/final-webkit/measure-3.png) · [4](review/final-webkit/measure-4.png) |

[简洁帧与小节轨迹](review/summary.json)；各目录 `natural.json` 为实播位置通知与逐帧 scrollTop，`layout.json` 为实际系统边界/小节映射，`sample.musicxml` 为同一输入。`checks.json` 记录最终两个引擎实际通过手动 wheel 退出、手动状态 seek 不拉视口、恢复、循环 3–4 小节回跳、比例/歌词重排。没有使用截图阈值作 CI 条件。

## 方法与限制

`review/capture-system-follow.mjs` 是独立验收脚本，复制到主仓库 scripts 下运行；先 npm ci、npm run build、安装 Playwright Chromium/WebKit。脚本仅在生成的 dist/session.js 暂时暴露已有 api/session，finally 还原；没有在产品源码留下调试接口。dev 模式版本化资源未由 Vite 直接托管，所以 route 用同版本 dist/client/playback 原始字体/SF2 响应，不替换合成器。baseline-session.js、candidate-session.js 是录制所用的临时编译快照；原脚本 /tmp 路径可指向它们。PHASE=before/candidate/final 选择录制；ENGINE=webkit 选择引擎。视频起止由 natural.json 的 clipStart/clipDuration 裁剪，比较两边均截 10 秒。

WebKit 缺少系统动态库，使用 apt 下载到 /tmp 解包并补充本地 Playwright 启动器库搜索路径后实际运行；未改系统安装。不是 Safari/iOS 真机验收。无 iPad、PWA、真实触屏惯性、真实曲库或主观视唱验收。截图与视频只含本地合成内容。

参考 [Soundslice 默认顶部注视区](https://www.soundslice.com/help/en/player/advanced/116/playhead-scrolling-options/) 与[官方滚动设计目标](https://www.soundslice.com/blog/28/new-smooth-scrolling-during-playback/)。其文档没有给出可直接照抄的时长；本次不复制其设置或提前滚动。最终在进入当前系统才判断，不提前遮掉上一行最后一拍。

最终产品 head：`451b89dfe6b311cd1035ebb3a3de5ce0edf7152f`。验证：播放器 396/396；工具栏客户端 1/1；生产构建的既有 Chromium `playback-scrub.test.mjs` 1/1；lint、typecheck、build、预缓存审计、diff whitespace 全通过。草稿 PR https://github.com/clydian/same-page/pull/684 。未合并、部署。
