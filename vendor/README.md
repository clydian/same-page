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

## 0.1.16 基础修复（包含于下列当前 0.1.17）

来源：[Chorus PR #11](https://github.com/clydian/chorus-score-studio/pull/11)，提交
`9f4adcaafe07f6f11660488ef83ffd9f2df8ead0`，叠加 0.1.15 的 offbeat 渐强线边界修复。

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


## 0.1.17 基础修复（混合延音链与有边界的源力度显示）

来源提交 `64122f37ccf2df0b188d09fff891c782b2da542d`。固定包
`clydian-chorus-player-0.1.17.tgz` 的 SHA-256：
`ac3d4345eacfd5c4a3af41c75152ca0ad09a0140f211e6820e2c52d95290e646`。
包含上述 0.1.16 的署名和相对速度修复；宿主的源 XML、已有用户数据及准备协议不变。

完整且相邻、无歧义的普通／移调声部延音链分配 importer-safe ID，避免已完成的
numbered origin 被后续 unnumbered stop 错误重用。最小实际宿主 MIDI 保留两个
G3 攻击，时长分别为 2400 与 5760 ticks。任何无法安全配对的 unnumbered endpoint、
带延音的 grace、复拍号时间线或 ID 预算耗尽均整 part 保留 native fallback；不声称
修复这些不支持输入原有的播放问题。

全部播放力度计算完成后，仅对能完整映射到精确发音位置的 track 恢复源力度 glyph；
不改变 note dynamics 或 MIDI。已复现并修复次声部进入时凭继承力度多印 f／p。
源标记在休止或拍间、非数字 voice、复合／未知标记、同音柱冲突、重复同值等无法
忠实显示时，整 track 保留原路径，可能仍有多余或缺失符号。望春风 Piano 的此类
fallback 未解决，不能把本次更新当作全谱显示保真。producer 的 dynamics
print-object=no 提示也保守 fallback，不冒称标准 MusicXML 4 隐藏符号支持。

宿主保留原 0.1.16 三项回归，新增真实安装包的 mixed ties／grace fallback／实际
SVG 单一源力度及旧 prepared payload 兼容断言。Worker 新 completeness 元数据为
可 structuredClone 的纯数据；没有该字段的旧 payload 保持原 marker 路径。

## 当前固定包：0.1.18，原生谱面 1.8.4-samepage.1

来源：[Chorus PR #14](https://github.com/clydian/chorus-score-studio/pull/14)，包构建源提交
`ef377f2577137a4273a2a36beeb2845290a16227`。播放器 tarball SHA-256：
`6eda617fd21b2cc6040b2775c0afc6c8460b6b1b74cd34b2d093cced4196e950`。包含 PR #13 的源渐变线显示修复。

宿主与播放器共享本仓库固定的 `coderline-alphatab-1.8.4-samepage.1.tgz`，
精确 peer 版本为 `1.8.4-samepage.1`，原生源提交
`9c1e050e3b02673c9d5344ca1b6fa03a476f0f18`。原生 tarball SHA-256：
`c5f84fa206cdeef0b4be7468be2d37e2ba447a4969b5a3a70c35fdfdd0edfc3f`。
清单含公开上游基线、源树及制品完整性；旁附 patch 与源码档案内 changes.patch
字节相同，供独立代码审查和重放，不通过开发目录链接生成运行时。

修复源歌词音节连字符、有限延长线及显式上下位置；力度显式标记可落在休止、
重复同值及跨谱表的发音间隙，并保留 direction 的 above/below。源时间不靠制造
音符或把标记移至近邻攻击实现。包内 source-copy 脚本在每次 build 校验原生版本和
源码 SHA-256，再将完整修改文件、重放 patch、许可及通知保留在公开
`/third-party/alphatab/` 内容寻址路径；历史快照不能覆盖或删除，也不加入离线预缓存。

Chorus 独立干净安装后 329 项测试、21 首目录检查、build/PWA 通过；29 份真实
输入的所有 MIDI 字段、顺序及小节 tick 与 0.1.17 相同。独立安装包的真实 Session
及准备/原生 Worker 完成四曲 285 小节逐个定位。这些不等于成员产品入口、全曲
连续播放耳听或二轮源谱验收。跨 voice/verse 歌词、自由拍图式、换气符和某些
钢琴渐变线仍有显示限制，不能把当前更新当作全部乐谱质量已达标。

## 共享符头布局修复：player 0.1.19 / native 1.8.4-samepage.2

来源为 [Chorus PR #16](https://github.com/clydian/chorus-score-studio/pull/16)，
构建源提交 `4c364b9`（main squash `68934362feef46b24c55372c8c91f813acb97cc1`）。
播放器包 SHA-256 `cc3091b44f05da732fd6248bb85146e1185ac22034c927e54063345b2cead31f`。
原生完整源提交 `d917b3e3faa5f64e1c524f9a41af19b537bf3a49`，在旧 .1 上仅新增
错误一侧的极端符头共享保护及其6个测试；没有加入未发布的换气、隐藏休止或渐变线改造。
原生包 SHA-256 `60e81212b5c3b960b2bbb00b588662fbcf8693a707bffc162e59c7a666176c47`。
源码档案 SHA-256 `283d6784a7601396fde378f22b2ad595c6df647a045563dc10d910d508211648`。

修复合法三声部钢琴在 Page/Horizontal 布局中的 `_canShareNoteHead` 崩溃。
源 XML、发音和时间线不变；精确 peer 确保宿主、引擎和 Worker 共用一个 native 实例。
Node24 独立 clone 构建，完整修改文件、可重放 patch、MPL 通知和清单随包保留；
公开内容寻址源码快照继续保留 .1。安装包最小回归旧 .1 两例红、新 .2 四例绿，
Chorus333测试通过。Come 6轨62小节 Page21/Horizontal7原生SVG不再崩溃，
7300 MIDI事件全部字段与62小节边界保持，O Nata14SVG字节不变。
这些不代表原谱全部图形或连续播放耳听已验收。

## 练习交互扩展：0.1.19-samepage.1

SamePage 本地播放器制品，在精确 0.1.19 基线上增加显式暂停跟随和按印刷小节歧义生成经过信息。源码补丁、固定来源、重建命令及 SHA-256 见 [制品说明](chorus-player-0.1.19-samepage.1.md)。原生依赖保持 1.8.4-samepage.2；没有跨仓库发布。

## AudioWorklet 初始化取消：player 0.1.19-samepage.2 / native 1.8.4-samepage.3

修复 #434：初始化期间立即暂停、结束或释放，不再对未启动 source 调用 stop；迟到
的初始化回调也不能连接已取消或已替换的播放。原生仅一个运行时文件变化，player
仅更新版本及精确 peer，保留所有既有交互扩展。来源、完整/增量 patch、构建脚本、
MPL 源码分发和回归边界见 [制品说明](chorus-player-0.1.19-samepage.2.md)。未跨仓库发布。

## 原谱独立渐变线与文字方向：player 0.1.19-samepage.3 / native samepage.4

修复[#486](https://github.com/clydian/same-page/issues/486)与[#487](https://github.com/clydian/same-page/issues/487)：
保留明确上下位置的独立渐变线及多个文字指令，原生跨小节连续线使用稳定layout lane。
保留samepage.3的AudioWorklet取消修复和既有交互扩展，播放器发音与源XML不改。
精确来源、MPL源码分发、可重建patch及实际回归范围见[制品说明](chorus-player-0.1.19-samepage.3.md)。

## 跨声部反序延音与钢琴缩谱名称：player 0.1.19-samepage.4 / native samepage.5

修复[#491](https://github.com/clydian/same-page/issues/491)的同谱表、同小节、相邻且唯一
的有音高延音端点反序导入，并保留公开 Worker JSON 关联；不推断多起点/多终点或
非相邻的音乐语义。修复[#492](https://github.com/clydian/same-page/issues/492)的窄
`Keyboard reduction` 名称识别，保留源名称和严格的 GM0/bank0 等共享键隔离条件。
完整已部署 source directions/session/AudioWorklet 行为保留；旧源码下载不删除。
来源与验证边界见[制品说明](chorus-player-0.1.19-samepage.4.md)。

## 原谱短句弧上下位置：player 0.1.19-samepage.5 / native samepage.6

修复[#497](https://github.com/clydian/same-page/issues/497)：保留 MusicXML 单条短句弧显式 above/below 的公开模型、Worker JSON 与原生绘制，未指定时仍自动布局。source ties、音符、发音和 AudioWorklet 不变。单头多 outgoing slur 的既有模型限制由[#498](https://github.com/clydian/same-page/issues/498)独立跟踪，不改 XML 或复制源音头掩盖。完整来源与验证范围见[制品说明](chorus-player-0.1.19-samepage.5.md)。

## 原谱保持音上下位置：player 0.1.19-samepage.6 / native samepage.7

修复[#499](https://github.com/clydian/same-page/issues/499)：保留明确 tenuto above/below 的公开模型、Worker JSON 与原生 effect band/glyph，缺省维持原布局。完整音频/播放器与旧源码下载保持；来源和验证边界见[制品说明](chorus-player-0.1.19-samepage.6.md)。

## 原谱文字字族与同刻多指示：player 0.1.19-samepage.7 / native samepage.8

修复[#501](https://github.com/clydian/same-page/issues/501)：六个受支持的generic字族列表通过typed模型/Worker保留，同刻多条文字不会因serif触发整part旧回退。缺省字体和其它属性保护保留，未改原谱。精确来源、MPL和验证范围见[制品说明](chorus-player-0.1.19-samepage.7.md)。


## 原谱有限方框与波浪延续线：player 0.1.19-samepage.8 / native samepage.9

实现[#505](https://github.com/clydian/same-page/issues/505)的同谱表有限 solid/wavy direction bracket 显示子集，公开模型与 Worker JSON 保留图形，不推断颤音、反复次数或自由段演奏。未知属性/样式整 span 保守拒绝；缺省与旧音频/session保持。来源、制品和未解决源谱范围见[制品说明](chorus-player-0.1.19-samepage.8.md)。


## 保留原谱音名拼写：player 0.1.19-samepage.9 / native samepage.10

修复[#507](https://github.com/clydian/same-page/issues/507)，沿用临时记号的降 B 保持原写法，不重拼升 A；精确源与MPL/回归边界见[制品说明](chorus-player-0.1.19-samepage.9.md)。#508谱号、#510跨谱表八度线仍独立待修。
