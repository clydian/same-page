# MusicXML 打开机制与性能核实（2026-10-22）

> 本文保留实施前的研究基准与决策依据；其中“当前”指该研究版本，不代表 #551 合入后的行为。产品实现和可执行回归见 [实施验证记录](../verification/2026-10-22-musicxml-startup.md)。原始诊断脚本留在研究工作区；本仓库仅收录不含谱文的摘要。

本轮未修改产品源码、云端数据或发布。用户反馈 iPhone/iPad 已安装版和 Android 打开 XML 慢；本轮没有这些实体设备上的 trace，不能把下面的实验值等同于用户实际总等待。

## 身份与方法

线上 `/build.json`：`f7920e7331a614d3d97a8096b3cc83c3ee75b289`，`v26.10.22.1225`。实验 engine、prepare worker、alphaTab worker 和字体/音色均按线上 build/manifest SHA-256 校验。当前源码 HEAD `9cfe46fa24bb039fd1fd0343a0ec385c0acb19e7`，相对线上 SHA，`src/client/playback/` 与 `packages/player/` 无差异。当前源码新增 release 路径支持不属于计时实验。

`measure.mjs` 在仅绑定 loopback 的独立 HTTP 服务中加载已验证生产 bundle，使用本地已保存的两份实际 XML：The Sun Never Says（5 声部、70 小节、514357 字节），Jesu, meine Freude（5 声部、441 小节、2532176 字节）。390×844 viewport。Chromium 4 倍 CPU throttle 只用于构造受 CPU 限制的情景；WebKit 为 macOS 桌面引擎。二者均不是实体手机/PWA。为了隔离引擎成本，本实验不包括主应用启动、附件鉴权、原文网络传输、Service Worker、IndexedDB 和后台离线准备。

## 已确认机制

1. 播放器 JS、alphaTab、字体和 SONiVOX 音色在谱子之间共用资源 URL；音色为同一个 1351896 字节 SF2。公共依赖不随 PWA 基础安装预取，而在首次 XML 使用时按需准备。当前线上完整离线依赖 manifest 有 15 项、12273272 原始字节；其中包括多个字体格式和 metadata，不等于首屏关键路径或压缩网络传输量。font/soundfont 路径含 build ID，新版本需准备匹配版本的包。
2. XML/MXL 原文可持久保存到 IndexedDB，但正常联网打开先取附件 metadata 校验权限/修订，再只读短期内存 preparation。内存未命中则 fetch 原文 URL；持久原文仅在离线、TypeError、5xx 时受验证回退。fetch 可命中浏览器 HTTP 缓存，服务端支持 ETag/304，不能称每次一定完整重传。明确 401/403/404 不回退旧文件。
3. preparation 内存缓存最多 4 项、32 MiB、固定 5 分钟，按 owner/session/drive/score/attachment/revision 隔离；读取不续期，刷新丢失。它保存 bytes 和预处理 XML/元信息，没有保存 alphaTab Score、MIDI、SVG 或活 synth。
4. 每次明确打开都新建会话；结束/离谱释放 alphaTab、renderer、synth/AudioContext。同次会话切换 PDF/XML/对照保留会话。重开从头开始是产品契约，但计算结果能否复用是另一层设计。
5. 即 prepared 命中，仍在主线程 DOMParser 提取小节标号、对 XML 做 ties/repeats 归一化、导入 Score、修正音乐模型、生成 MIDI、排版/绘制。新 synth 从缓存读取同一 SF2 字节后仍需解析音色、准备 presets。
6. ready 表示 MIDI/音色链路可播放，不等于谱面已完成。首个 SVG 和 postRenderFinished 单独计时；alphaTab lazy rendering 下也不能声称全曲所有 SVG 都完成。

主要代码入口：`src/client/playback/musicxml-player.tsx:38`、`playback-preparation.ts:4`、`offline-musicxml.ts:37`；`packages/player/src/session.ts:175`、`engine.ts:22`。

## 复现结果

两轮未改动生产 bundle 的独立运行中，Chromium 4 倍 CPU throttle：

| 场景 | 可播放 | 首个谱面 SVG |
|---|---:|---:|
| Sun，第一个会话，无 prepared | 1.17–1.33 s | 1.33–1.47 s |
| Sun，紧接着重开，prepared 命中 | 0.47 s | 0.57–0.60 s |
| Jesu，换谱，prepared 未命中 | 1.82–2.04 s | 2.74–3.34 s |
| Jesu，紧接着重开，prepared 命中 | 1.55–1.84 s | 2.14–2.73 s |

Jesu 热开 SF2 资源返回 `transferSize=0`，缓存读取仅几毫秒，但仍有约 1.1 s 在首次 parts 状态之前消耗于主线程建模/归一化，完整同步任务约 1.4 s。说明引擎重新准备本身就是已复现的等待来源；不能据此声称用户手机上的网络占比为零。

macOS WebKit 未 throttle 的两轮热开 Jesu：可播放 0.65–0.68 s、首个 SVG 1.26–1.59 s。首次模块 import 有 JIT/浏览器状态波动，见原始数据；表中会话计时在模块 import 之后开始。

反馈命令：

```sh
ASSERT_BUDGET=1 REPORT_NAME=timings-repeat.json node artifacts/diagnostics/musicxml-startup-2026-10-22/measure.mjs
```

已执行，exit 1：`Jesu warm readyMs=1550.1, firstSvgMs=2138.5, verdict=SLOW`。1 s 是诊断脚本自行设置的检测预算，不是既有产品性能契约。未改动 bundle 的两轮均能检出长谱热开超过预算。

## 重复计算证据

浏览器捕获同次开谱 2–3 次 `alphaTab.midiLoad`，热开稳定为 3 次。匹配版本 native13 源码可解释：`_internalRenderTracks` 先经 `_onScoreLoaded` 生成，再直接生成；synth ready 还可能再生成。`timings-midi-instrumented.json` 来自仅追加诊断 export、包装 `loadMidiForScore` 计时的 bundle 副本，没有更改调用语义。Chromium 热开 Jesu 三次合计约 223 ms；这是该阶段总量，不能直接等同于可省去的时长或所有手机的开销。

`measure-import-cpu.mjs` 使用版本完全匹配的 native13/player .12 artifact，在 Apple M2 的 Node 25.9.0 下每谱 7 次，去掉前两次取中位：prepared→Score Sun 138 ms，Jesu 418 ms。其中 Sun ties/repeats/import 为 67/34/17 ms；Jesu 为 167/103/148 ms。这是分段独立中位，不精确相加；也不包含浏览器、MIDI、音色或排版时间。

## 尚未排序的完整应用开销

- 每次 mount 初始化与 lifetime verify 各请求同一附件 metadata；实际网络影响尚无实体设备 trace。
- 已存公共资源每次使用仍做 size/SHA-256 校验；每次后台离线准备会重新审计整包和壳。它们不被前台 player 创建 await，不能直接说是 readiness 的串行阻塞。争用 CPU/存储的占比未测。
- 本轮未测 PWA 冷启动、频繁更新导致的重新准备、手机实际网络和首次按播放至可听见声音的延迟。

## 建议顺序

先减少已确认的重复 XML 归一化/导入及 MIDI 生成，把可复用的不可变计算结果纳入准备缓存；随后在完成当前权限和修订验证后复用匹配的本地原文，避免额外文件再验证；再量化公共 synth/音色解析复用和后台离线校验调度的收益。保留每次新会话默认从头开始、身份/失权/修订隔离及既有离线权限边界。

原始数据：`timings.json`、`timings-repeat.json`、`timings-midi-instrumented.json`、`import-cpu-results.json`。所有诊断脚本与 instrumented 副本均保存在此明确标注的 `artifacts/diagnostics/` 目录。
