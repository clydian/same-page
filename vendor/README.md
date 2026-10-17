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

## 共享钢琴击键修复：0.1.11

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

## 源拍号可见性与力度重置：0.1.13

来源：[Chorus PR #7](https://github.com/clydian/chorus-score-studio/pull/7) 与
[PR #8](https://github.com/clydian/chorus-score-studio/pull/8)，最终提交
`f213db15eb2ddbf4eb4cb444580fe03b421ee446`。Node 24 执行 workspace test、build
和 pack；本仓库固定安装 `clydian-chorus-player-0.1.13.tgz`，SHA-256 为
`a49738cbdc703895ff0283345e3e9d976e9bfb6a72afd7d81c3d8ba69b66efb1`。

尊重源 XML 明确的 `time print-object="no"`，通过公开 BarStyle 隐藏对应谱表的小节
拍号，保留时间和布局空间。按 part-list ID 映射，支持 numbered staff 显示覆盖；
不扩大为完整 polymeter 或后续系统开头重复拍号的修复。纯 XML 元数据解析与引擎着色
分离，避免 alphaTab 运行时在准备 Worker 中初始化自己的渲染／合成协议。

明确力度结束之前的文字渐强／渐弱推断，包括相同值与相反方向。力度继承、起点恢复
和渐变目标共用作用范围优先级；保留既有钢琴整体作用规则、声部间共同插值网格与
下一文字／渐强线边界。没有明确目标的渐变增量属于练习演奏解释，并非原谱精确力度值。

共享源 232 项全测、21 首目录校验和 build/PWA 通过；26 项重点测试对实际解包产物
重复通过。23 条交付记录的全部非力度事件字段、顺序和小节 tick 不变，仅 Christus
22 个及 If Music 446 个力度事件变化；独立原 PDF 核对支持其明确力度边界。
这些回归不代表全曲源谱验收或耳听通过。

宿主直接测试安装包的隐藏拍号／Worker 序列化与相同力度重置；浏览器还检查实际
构建准备 Worker 的首条响应及隐藏拍号元数据，并保留完整播放与 PDF 切换流程。

## 否定渐变词：0.1.14

来源：[Chorus PR #9](https://github.com/clydian/chorus-score-studio/pull/9)，提交
`6f22b6d15fedaa4e03ab47067260026d5389fe59`。Node24 构建并打包，固定包
`clydian-chorus-player-0.1.14.tgz` 的 SHA-256：
`d1d1f37b62098666f15267511efbbc8e2a1905f8fbd57f5e45c024099ff5357d`。

修正 `non dim.` 被误当作渐弱的既有错误，保留原文字和明确力度。只处理支持的渐变词
前紧邻的 `non`；`dim. non troppo`、`non troppo dim.`仍为肯定渐弱，混合指令按词组
处理，保持既有肯定渐强优先规则，不声称支持完整自然语言或意大利语解释。

源247项全测与build/PWA通过，实际包41项重点测试通过。23条交付记录对实际0.1.13
比较，只有If Music的8个攻击和8个释放力度变化，其他所有事件字段和小节定位不变；
原PDF第34小节四声部印有non dim.。使用真实addNote handler和库事件类识别，不能
将引擎内部type枚举当作MIDI线缆状态码。未声称耳听或整曲验收。

宿主新增实际安装包的否定表达及肯定程度限定语回归，继续验证原有准备Worker、
隐藏拍号、力度重置与完整浏览器播放/PDF流程。

## 当前固定包：0.1.16（创作者角色与简单相对速度）

来源：[Chorus PR #11](https://github.com/clydian/chorus-score-studio/pull/11)，提交
`9f4adcaafe07f6f11660488ef83ffd9f2df8ead0`，叠加 0.1.15 的 offbeat 渐强线边界修复。固定包
`clydian-chorus-player-0.1.16.tgz` 的 SHA-256：
`30e7d5eac93d5b31dd1d5ea0e7f52dacc302a92f59f5addd18416f87039f5d4c`。

按源 MusicXML 的 composer/arranger 类型分别呈现作曲与编曲，不再把编曲者误标为
音乐作者；新 prepared.creatorCredits 是可 structuredClone 的纯元数据，旧 payload
继续从原字节解析。准备 Worker 不导入渲染运行时，源 XML 字节保持不变。

支持两个简单 beat-unit（含附点）的速度等式，并从此前有效速度推导隐藏的播放速度。
Cantate 第 26 小节 dotted-half=whole 把默认 quarter120 转为 quarter160，而不捏造源谱
未印出的 160 数字。该等式的原生字形显示仍有限制；复杂连音／范围／pass-specific
关系保留 native fallback。同一时点显式 sound 速度仍优先，但与印刷速度不同时不将
胜出的播放数值伪装成印刷标记。初始 120 是播放器默认值，非原谱标注。

源码 281 项测试与 build 通过。实际解包产物对 23 条交付记录、望春风 v7 和 Cantate
完整 v3 共 25 输入比较，全部非速度字段与 tick 保持一致；只有两条 Cantate 及完整
v3 添加预期速度。宿主新增实际包 SVG 署名、prepared clone／旧 payload、相对速度
真实 MIDI 及冲突数字可见性回归，并在真实构建 Worker 两浏览器验证 metadata 和
速度 sidecar。此处不代表这些谱目已完成生产或耳听验收。
