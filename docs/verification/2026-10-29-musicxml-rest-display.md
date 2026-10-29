# MusicXML 显式休止符位置 · #559

原谱指定整小节休止符在高音谱表 E4，合法 XML 已保存 display-step/display-octave；native19 导入时丢弃位置，重排到 F5。修复保留独立的 C0=0 自然音级坐标，依当前时点谱号绘制，不赋予音高，也不改写 XML、声部或 MIDI。字段随 JSON/clone 进入 Worker，旧 JSON 无此字段仍走原来的自动排版。

## 历史 native20 控制制品（含八度谱号遗漏，已由22源修正取代）

- native20 SHA256：`827c21daceb90985db45591fbde4d5deb7864d35b852c45b6bbae3f95263f06a`。
- 源提交：`cc0b4a00fe0033f4cd04f86a4a8f69eaf1d32210`；源码档案 SHA256：`60b59f26c4c494aae5178f67b2258b36949dace948253e24cb91daec4c297ec2`。
- 保留 native19 和历史公开源码档案；不涉及用户存储或 API 迁移。

## 历史 native20 验证记录（不计作22门槛）

Node 24.22.1。原生新增测试覆盖谱号、小节内变谱号、两种布局、多声部、隐藏/默认休止、非法/不完整坐标、JSON/clone 与完整 MIDI。

- 最终原生全套：1885 通过、64 失败、1 可选外部谱 probe 跳过。剩余 64 项逐名等于 native19 已知失败，无新增失败，不能称全套绿色。
- 新位置合法改变两张参考图；另一个导入快照仅多出两个源 D5 坐标 36。逐项对照源夹具后只更新这三项期望，不修改对比容差或 helper。
- 11 种未指定位置的休止符，SVG 与位置/MIDI JSON 对照 native19 逐字节一致。
- 旧20完整110小节、五轨谱的333个显式坐标在旧映射下导入/JSON/两布局自洽；后续独立规范及引擎矩阵发现，该映射遗漏clef-octave-change，相关Tenor坐标正确性结论撤回，须用修正后的当前谱号映射重新验证。glyph ink边界检查不代表全排版或原PDF正确性。
- 最终安装包 + 正式播放器准备：8456 个完整 MIDI 事件与 110 个小节边界均和 native19 精确一致。
- 最终制品真实 Chrome renderer Worker：两种布局完成全 110 小节，实际传输 333 个坐标，第 66 小节 E4=30 保留，无 Worker 错误；实际查看该系统。
- player 356 项、Node 374 项、typecheck、生产构建通过。
- 现有 Chromium/WebKit 准备 Worker、播放/PDF 切换、启动、离线与源码分发回归 16 项通过。
- 全 client 首跑 1420 通过、2 条 PDF 呈现测试失败；保持原始失败。两个完整文件低并发复跑 49/49 通过，相关源文件与 main19 相同，未启动 native 链。未确证偶发失败根因，不称全 client 全绿，也不修改断言/超时掩盖问题。

先前 Standards/Spec 无阻断结论在八度谱号范围内撤回：新发现为 native20 的实际源缺陷。以上均为本地验证；PR 最终 head CI、合并及实际部署身份另行核对。真实谱没有提交至仓库。本修复不声称解决琶音播放、歌词演唱或整首作品的耳听验收。

## native22 源修正与待完成门槛

原生休止 glyph 现在同时读取当前时点的 clef 与 clefOttava，只作 ±7／14个自然音级显示换算；percussion 固定普通G4，不使用instrument transpose或独立beat octave-shift。初始+2谱号枚举同步纠正为15ma，与timed路径一致；该特殊输入音头的显示八度也随之纠正，音符realValue与完整MIDI保持原样。字段、JSON兼容与未指定坐标的默认路径不变。

本轮源测试50通过、1个外部谱probe跳过；G8下移B3在原控制实际paint为11staffsteps（应4），修后两布局均4。另保存+2枚举错误的真实红控制（-24应4）及输入G5 realValue79、完整MIDI原始对照。G/F±1/2、timed changes、percussion、transpose/beat ottava、旧默认休止与JSON/clone均在定向范围内。尚未更新完整原生结果、打包身份、产品或Worker门槛；不沿用上一节旧20结果宣称22完成。

## 独立oracle的流程教训

原PDF的物理线位观察不等于正确的MusicXML坐标命名。观察到Tenor休止在中线是有效事实；在G8下移谱号下应编码B3，不能直接套普通G2中线B4。oracle若使用与待验证引擎相同的“忽略clef octave”假设，再与该引擎比较，只证明同一假设自洽，不能证明标准正确。

新增八度谱号支持前，先查目标元素与当前clef的正式规范，再用独立引擎的最小矩阵（G/F、±1/2、普通谱号、instrument transpose及独立octave-shift控制）冻结映射；随后核源谱物理线位、XML坐标、导入字段与实际绘制。MIDI/小节边界验证负责证明声音与时序保护，不能代替源谱和几何oracle；字段传输与Worker无错也不能代替位置正确性。保留旧错误控制和撤回范围，新source/render/MIDI证据分别绑定最终文件与包身份。

## native22最终固定制品门槛

源提交 `a320a5478087ba88f4940ac2faaaf2eb4d0638a3`；源码树 `4c7177d891ad87e0ade2ded615b69b953c8e2636`；包SHA256 `ed80b5cf6bac013604aaf33b755c826be3811232987895486f02badaf42f1537`；源码档案SHA256 `6c157617a641052e216304e78adcba78a6b3fdbc1419cb8038f71fff64051b41`。保留旧20/19及历史公开档案，没有覆盖旧来源。

完整原生1910通过、64失败、1外部probe跳过；64失败逐名精确等于native20已知集合，无新增。最终安装包player356通过；产品typecheck和生产构建通过。实际Chrome renderer Worker分页与横向均完成110小节五轨、333个显式休止坐标传递，E4=30保留，无Worker错误。输入为已纠正G8down坐标的本地v28，SHA256 `6b9a0c89c44397174e53128424e05f4d59c8cff9a7c95a24e1c48e4f4773ab2f`，不提交真实谱。v28在native22正式播放器准备链的完整8456MIDI事件和110小节边界精确等于native19/r10。规范/独立最小矩阵、源谱物理线位、字段传输及实际paint分别验证，没有从引擎自算全曲oracle来证明自身。

以上是本地结果，最终head CI与生产身份另行核对。旧client首跑/复跑结果仍按历史章节原样保留；未把它改写成native22完整client验收。当前修复仅休止显示与初始+2谱号显示枚举，不宣称琶奏播放或全曲耳听完成。
