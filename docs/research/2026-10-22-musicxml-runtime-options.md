# MusicXML runtime 优化选项核实（2026-10-22）

> 本文保留实施前的研究基准与决策依据；其中“当前”指该研究版本，不代表 #551 合入后的行为。产品实现和可执行回归见 [实施验证记录](../verification/2026-10-22-musicxml-startup.md)。原始诊断脚本留在研究工作区；本仓库仅收录不含谱文的摘要。

本页针对播放器、synth、音色和首屏排版。只修改本页和 `artifacts/diagnostics/musicxml-startup-2026-10-22/` 下的独立诊断材料；没有修改产品代码、替换 vendor、发布或操作云端数据。

结论：先消除同一次开谱重复 MIDI 生成，再扩大可复用的不可变准备结果。共享整个活播放器不是当前首选。公共音色解析复用有技术空间，但应独立测量后再决定是否值得引入长期存活的 synth；“所有谱共用代码”和“保留一个带状态的播放器”是两件事。

## 证据边界

- 基线及线上资源身份见 [findings.md](2026-10-22-musicxml-startup-baseline.md)。本页使用其中匹配线上版本的 `0.1.19-samepage.12` / `1.8.4-samepage.13`，没有使用根目录普通 upstream alphaTab 作为 native13 替代。
- 源码目录为 `artifacts/transcription/2026-10-21/native-notation-performance-release/installed-pair13-host/node_modules/@coderline/alphatab/dist/alphaTab.core.mjs`。下文 native13 行号均指该文件。
- 官方网页于本轮重新访问，但网页可能说明较新的 alphaTab；已存在能力以匹配的本地 native13 实现复核。
- 浏览器诊断为本机 Chromium 4 倍 CPU 降速及 macOS WebKit，不是 iOS/Android 真机。CPU 调度和 JIT 有波动，因此不从单次对照声称改善百分比。

## 实际生命周期与已确认重复

`packages/player/src/session.ts` 的 `createPlayerSession` 每次建立 `AlphaTabApi`，每次明确结束调用 `api.destroy()`。API 将 renderer 包装成 worker，同时创建 synth worker 和 WebAudio output。native13 的 `destroy()` 依次销毁 player、UI、renderer（46809–46813）；output 销毁会关闭 AudioContext（25575–25580）。这符合当前 [CONTEXT.md](../../CONTEXT.md) 的新会话从头开始、结束/离谱/身份切换/已确认失权停止并释放的契约。

一份新 Score 被 `renderScore` 接收后，native13：

1. `_internalRenderTracks` 调用 `_onScoreLoaded`（47015）；
2. `_onScoreLoaded` 经过 `_setupOrDestroyPlayer()` 再调用 `loadMidiForScore`（49195–49199）；
3. `_internalRenderTracks` 紧接着再次调用 `loadMidiForScore`（47016）；
4. synth `ready` 事件再次调用 `loadMidiForScore`（46754–46756）。

实际已观察首次 2 次、热开 3 次。第 2、3 步是同一调用栈明确重复。第 4 步承担晚到 player 初始化后的加载，不能仅以全局“一生一次”标记删除。官方 [loadMidiForScore](https://alphatab.net/docs/reference/api/loadmidiforscore) 也说明显式调用用于设置改变后的 MIDI 重建，并会停止播放。优化必须保留这个能力。

每次 `loadMidiForScore` 不仅重新生成事件，还创建 tickLookup、设置播放范围、发送 MIDI 到 worker、载入 backing track 和同步信息（47892–47915）。synth `loadMidiFile` 每次调用 `_checkReadyForPlayback`，其中重新 `loadPresets`（41145–41156、41163–41173）。去掉重复生成会同时减少主线程计算、消息/数据转换和部分下游工作；不能将三个阶段的重叠耗时直接加成可节省的总等待。

## 独立对照验证

新增三个仅诊断用脚本，将相同 production bundle 的 `AlphaTabApi` 原型包装，不改产品源码或生成 MIDI 的语义。

| 策略 | 新开一首 / 热开 MIDI 次数 | ready 与 SVG | 适用结论 |
|---|---:|---|---|
| baseline | 2 / 3 | 两引擎成功 | 复现重复 |
| single-stack：仅阻止同一 `_internalRenderTracks` 调用栈中的第二次生成 | 1 / 2 | 两引擎成功 | 最小去重有直接依据 |
| ready-gated：player ready 前暂缓生成，同时消除同栈重复 | 1 / 1 | 两引擎成功 | 可以收敛到一次，但要正式设计 pending/revision 状态 |

每种策略均跑 Sun/重开 Sun/Jesu/重开 Jesu/再开 Sun，共两个引擎、10 个场景。原始报告为 `runtime-baseline.json`、`runtime-single-stack.json`、`runtime-ready-gated.json`。这里确认的是调用次数和基础功能可行性；不是优化方案的正式性能验收。

`measure-runtime-audio.mjs` 另外经真实点击启动播放，从实际 WebAudio output 分支接 AnalyserNode，确认两引擎、两真实谱共 4 场景非零波形（peak 0.159–0.377）、播放状态和暂停。报告为 `runtime-ready-gated-audio.json`。首次尝试发现诊断服务器没有 worklet，补下载 `/assets/alphaTab.worklet-CwK2Y77c.js` 并按线上 build SHA-256 校验后完成验证；原报告已由成功的完整实验覆盖。非零采样不替代耳听、实体设备、快切、后台恢复与竞态验收。

正式修正应做在 native vendor 的受控源补丁：统一新 Score 的 MIDI 入口，按当前 score revision 和 MIDI 相关设置 revision 标记 pending/loaded；player 晚到时仅补发当前有效结果；显式 `loadMidiForScore` 仍可强制重建。不建议将这里的 prototype monkey patch 带进产品。先做“去同栈第二次调用”是更小的交付；合并晚到 ready 路径可以在同一修复中完成，但须测试初始化的两种顺序和销毁后的晚到事件。

## 音色缓存究竟能复用什么

SF2 原文缓存命中只省网络/读取。native13 `loadSoundFont` 每次创建 `Hydra`、解析 RIFF 和音色表，保留原 sampleData（41127–41140）。`Hydra.decodeSamples` 把所需 PCM 转 Float32，并在当前 Hydra 内缓存（38805–38834）。`TinySoundFont.loadPresets` 仍遍历音色/region，但只为实际 MIDI programs/percussion keys 解码使用到的样本（40810–40828）。因此：

- 已有同一个 synth 内的已解码 sample 缓存；全文件有很多 presets 不等于它们都完整解码。
- 换成一个跨谱 synth 可以保留 Hydra/sample 缓存，但每次换 MIDI 仍可能重建 presets；不能宣称全声音成本归零。
- 只保存 SF2 ArrayBuffer 没有解决 Hydra/Float32 工作。
- 缓存完整 presets/Hydra 可与活 AudioContext 分离，但 native13 没有稳定公开的 parsed-bank 注入/共享 API；需要新增受控 seam 和内存/样本率测试。

官方 [loadSoundFont](https://alphatab.net/docs/reference/api/loadsoundfont) 和 [player](https://alphatab.net/docs/reference/api/player/) 提供字节加载及只读底层 player 访问，没有一个可直接设定“全页面共用现有 synth”的配置。官方 [Low Level APIs](https://alphatab.net/docs/guides/lowlevel-apis) 提供分开使用 ScoreRenderer、MIDI 和 AlphaSynth 的路径；选择这条路要自己接生命周期、游标、事件与播放器状态，不是更换一行设置。

建议先增加 sf2Fetch、HydraParse、PresetBuild、firstPlayWorkletInit 分段数据。只有声音初始化在目标真机占比仍明显时，再选择以下两种之一：

| 选项 | 实际收益范围 | 主要代价 | 建议 |
|---|---|---|---|
| 每会话独立 synth，缓存可共享的 parsed sound bank/decoded PCM | 减少跨会话音色解析和样本转换；不影响关闭声音硬件 | 需要 vendor API；定义不可变 bank 和引用释放；内存上界；样本率或 bank 版本键 | 优先做小型可撤回原型，再用真机数据决定 |
| 每页面一个 synth/AudioContext，不同新会话租用 | 同上，另避免部分 worker/context 初始化 | MIDI、channel/mix、loop、tick、事件彻底重置；独占租约；结束后卸载受保护谱数据；后台/中断/路由恢复 | 仅在前几阶段后仍有足够收益时考虑 |
| 结束后隐藏整个 AlphaTabApi/会话，重开重新展示 | 同谱可保留更多 render 状态 | 违反当前结束释放契约；DOM/Score/worker 和播放状态留存；权限撤回、内存与旋转重排复杂 | 不作为方案 |

“每页面一个”也不等于跨窗口、跨 PWA 进程共享。不能依赖后台进程持续存在来保证重开速度。

Web 平台确实鼓励 [复用 AudioContext](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext)，但这条一般建议不构成保留整套 private score/synth 的理由。闲置时 [suspend](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/suspend) 能减少硬件与 CPU 使用；[close](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/close) 释放系统资源。iOS 存在 [interrupted 状态](https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/state) 和恢复过程，复用设计必须覆盖中断后恢复及失败重建。

## ready、谱面首屏与真正出声必须分别测

官方 [playerReady](https://alphatab.net/docs/reference/api/playerready) 定义 synth、音色和 MIDI 就绪。native13 AudioWorklet output 的 `open()` 先立即发 ready（42693–42697），`play()` 才调用 `createAlphaSynthAudioWorklet`、实例化 AudioWorkletNode 并连接输出（42699–42724）。所以当前 UI ready 不能证明首次点击到出声的路径已经完成。

已核验线上 worklet 原始 JS 是 2,371,569 字节。它已在离线资源 manifest 内，但首次后台准备未完成时，第一次点击仍可能涉及获取/编译/实例化；字节数不等于压缩网络传输大小，也不是确定的耗时。应独立记录首次 click→非零音频/可听声音。明确开 XML 后可以评估预取 worklet 模块或更早准备节点，不能因普通 PDF 阅读就创建音频硬件，也不能让后台校验抢前台计算。节点预热还会触及既有快速暂停/销毁竞态，不能只加 `preload` 就宣布问题解决。

## 排版首屏选项

当前已默认开 worker 与 lazy rendering；官方 [enableLazyLoading](https://alphatab.net/docs/reference/settings/core/enablelazyloading) 的能力主要是按可见块延迟生成/插入显示。native13 PageView/VerticalLayout 的 `_layoutAndRenderScore` 仍循环全部系统（59905–59918），为每个系统建立 bounds（59922–59935）。因此“开启 lazy 就只算首屏”不成立，也不能把 `postRenderFinished` 当所有 SVG 已呈现。

优先做准备结果复用并尽早把完整模型提交 renderer，再分别观察首个真实系统 SVG 与最终 layout/bounds ready。首屏度量需排除只出现标题的 SVG。不要以 loading 消失或标题闪现替代用户能读第一行五线谱。

若这一阶段后长谱首屏仍慢，再做单独的布局实验：保留全曲播放数据，同时让前几个系统的 partial 更早绘制/返回主线程；后续 bounds/系统逐步补齐。要证明 first-system 延迟来自 worker 同步排版阻塞，才值得改 vendor 为可让出任务的分段布局。不能用裁掉后半曲的 `barCount` 假装优化：API 的 MIDI/tickCache 也会参考显示范围，会影响全曲 seek、repeat 和循环。调 `barCountPerPartial` 在当前纵向一系统一块的实现上也不是现成解法。

不建议首期持久化 SVG 或固定像素布局：宽度、方向、字号、字体/engine 版本、声部组合及坐标 bounds 都会使其失效；容易增加缓存和命中判定复杂度。可以在以后有数据支持时缓存同 viewport 的内存快照，但不能与 live 模型/bounds 混用。

## 推荐交付顺序和最低验收

1. 合并关键阶段计时；一次开谱记录 metadata/source、prepare/import/model、MIDI、soundfont、first-system、bounds、首次点击至声音，区分 cold/warm/reopen/other-score。无实体设备 trace 前不承诺固定提升倍数。
2. 修复重复 MIDI：首次 player 初始化先/后于 Score 两种顺序都稳定一次；显式设置变动重建仍生效。覆盖 repeat/ending、tempo、ties、piano correction、track mix、seek/loop、结束快切和毁后事件。
3. 扩大只读准备缓存和把归一化/建模移出主线程（与 source/cache 研究合并）；保留每次新 PlayerState 初始值。从头开始是交互状态，不等于必须重新解析。
4. 真机复测后，才决定 parsed soundbank 或单 synth 租用是否值得。若收益主要仍在 XML/model/layout，则继续优先处理这些阶段。
5. 仅当真实首系统仍占主要等待，再研究分段布局。必须保留完整播放 timeline、可用时才启用点谱定位、旋转/重排锚点、自动跟随与 solfege bounds 正确性。

第 2–3 步可以保留当前持久原文格式，不需要持久化 vendor Score。alphaTab 官方 [序列化说明](https://alphatab.net/docs/guides/lowlevel-apis#serialize-data-model-fromto-json) 明确不保证该表示跨版本稳定；worker 同版本传输可用，长期 IndexedDB 记录应另有 schema/version 契约和回退到原文的路线。权限/本机 owner 和 session epoch 检查要覆盖所有派生缓存与迟到回写，不能只保护原始字节。

需要至少一台 iPhone/iPad 已安装版和一台 Android 已安装版，验证打开、结束重开、跨谱、后台恢复、旋转、耳机/扬声器切换及系统回收后的冷启动。桌面非零音频证明当前诊断没有只停在 ready 事件；它不证明手机音频恢复和实际听感。
