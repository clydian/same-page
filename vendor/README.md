# Chorus Player artifact

`clydian-chorus-player-0.1.0.tgz` 来自独立 Chorus 仓库的共享播放器包：

- 源码：https://github.com/clydian/chorus-score-studio/tree/48996f30db123b5d7cf88f9328e10443211c9b69/packages/player
- 提交：`48996f30db123b5d7cf88f9328e10443211c9b69`
- 构建：Node 24，源码仓库执行 `npm ci`，然后 `npm pack --workspace @clydian/chorus-player`
- 安装：本仓库执行 `npm install ./vendor/clydian-chorus-player-0.1.0.tgz`

包只含编译后的模块、类型及 README；不含曲库、房间或用户数据。锁文件固定压缩包完整性及传递依赖。生产构建不读取相邻仓库，也不调用 Chorus 网站。修复先在 Chorus 中完成，后续发布递增包版本并更新本文件与锁文件。

0.1.6 修复首谱表反复结尾被后续声部覆盖；来源、构建和验证见 [chorus-player-0.1.6.md](chorus-player-0.1.6.md)。

0.1.7 修复转调乐器无编号延音匹配到旧小节的问题；来源、范围和实际 MIDI 回归见 [chorus-player-0.1.7.md](chorus-player-0.1.7.md)。

0.1.8 修复不同声部复用显式延音编号导致的音高与时值错配；来源、保守边界和完整候选 MIDI 回归见 [chorus-player-0.1.8.md](chorus-player-0.1.8.md)。


## 速度修复：0.1.10

来源为 [Chorus PR #5](https://github.com/clydian/chorus-score-studio/pull/5) 的提交
`bb95d2c2f67ecdc4718a6fa2574c95d8bcc8ba33`。Node 24 执行 `npm ci`、
`npm test`、`npm run build` 后，使用 `npm pack --workspace @clydian/chorus-player`
生成本仓库的 `clydian-chorus-player-0.1.10.tgz`；完整性由锁文件固定。
该源码先将生产 0.1.8 整理回共享仓库（28 个 dist 文件逐字节一致），再修正速度。
未采用的本地 0.1.9 游标实验不在此包中。

修复 metronome 附点与非四分音符单位、sound tempo 覆盖优先级、按 divisions
换算的方向 offset、弱起小节变速时点及同小节返回先前速度。原 XML 保留节拍器记谱，
准备阶段额外携带速度时间线；旧 prepared payload 使用解析 fallback。
alphaTab 原生速度字形仍显示等价四分音符 BPM；复杂 metric modulation、范围速度、
time-only 及负数跨小节位置保留 native 行为，不能据此声称全部表达已实现。

共享包 191 项测试（30 项速度回归）和 CI 通过；23 条产品谱目交付记录的完整音符
MIDI 事件与 0.1.8 相同，仅《Come to Me》的同拍 108→27 修正为 108，源 PDF 为
二分音符=54。此回归比较不等于整曲精校或耳听通过。
`src/client/playback/musicxml-tempo.node.test.ts` 直接验证已安装压缩包的实际 MIDI，
包括经过 structuredClone 的 prepared 数据；反复结尾与延音测试继续验证既有修复。

## 当前固定包：0.1.11

来源：[Chorus PR #6](https://github.com/clydian/chorus-score-studio/pull/6)，提交
`96bdb74cca8579fb00ef380301a4974607d1ff73`，叠加上述 0.1.10。Node 24 执行
`npm ci`、`npm test`、`npm run build` 后执行
`npm pack --workspace @clydian/chorus-player`。包 SHA-256：
`a87f2616ac9db3d72534dad77abe8eba620677845ff2ed36c3ed0a9f16568992`。

钢琴同一键在同一时点写入多个声部时，在公开 midiLoad 事件中合并实际击键，保留
最大力度和最晚原始 NoteOff，不修改 XML、谱面模型或原生小节定位。仅处理明确命名
Piano/Pianoforte/钢琴且初始及当时 program/bank 都为 0 的同轨道、通道、时点和音高。
其他乐器、轨道、通道、稍后重击及控制/弯音/结束事件保持原行为；发现候选时额外生成
一次 MIDI。原生 MIDI 下载及独立 exportAudio 是另外的路径，不自动应用此播放修正。

共享源码 15 项专门回归、206 项全量测试、21 首目录校验与应用/PWA 构建通过。实际
AlphaSynth 最小对照中，旧版起音 RMS 为单键对照的两倍；修复后 PCM 与最大持音的
单键对照逐样本一致。24 份真实/局部 XML 比较确认非目标事件及顺序不变。这些是数值
合成与事件检查，不代表人工听验或整曲源谱验收。

`src/client/playback/piano-shared-attacks.node.test.ts` 验证已安装包保留源双声部、合并
同键攻击、保留长时值和稍后重击，且不把默认 GM program 的 Voice 当作钢琴。
