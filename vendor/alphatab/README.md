# Same Page alphaTab 维护

日常开发直接使用 `vendor/coderline-alphatab-1.8.4-samepage.22.tgz`；不编译原生引擎，不需要 Chorus 或其他私有仓库。播放器源码在 `packages/player`。

## 修改并重建

- `SOURCE-MANIFEST.json` 记录迁入基线：公开上游 `022a45c8e42370f9e12e68949d11eada370da83d`、原修改源提交、树及文件校验值。它是历史基线，不是后续编辑文件的校验清单。
- `changes.patch` 从该公开上游恢复完整修改树（包括新增、删除及二进制变更）。
- `modified-source/` 保存完整修改文件、原生测试及其测试输入，作为本仓库可直接编辑的覆盖层。新增修改文件按上游相对路径放入此目录；需要删除文件时同步调整补丁。

使用 Node 24，修改 `modified-source/` 后，在仓库根目录执行：

```sh
npm run build:native -- --version 1.8.4-samepage.22 --output /tmp/same-page-native-22
```

命令从固定公开上游建立独立临时 Git checkout，应用补丁和当前覆盖层，提交源码快照，再构建并打包。它只访问公开 alphaTab 和 npm，不访问 Chorus。输出目录必须为空，临时 checkout 保留供检查和原生测试；路径打印在输出中。运行 checkout 内与修改相关的原生测试，再运行完整原生测试。打包成功不代表测试通过。

输出包括固定原生制品、完整修改源码档案、许可证和 `native-package-manifest.json`。构建时间与本地 Git 元数据会影响制品字节，不承诺逐字节可重现。迁入基线的源码树可以与 `SOURCE-MANIFEST.json` 的 `sourceTree` 核对。

确认验证通过后，把新制品放入 `vendor/`，更新根 `package.json` 的原生依赖和 `packages/player/package.json` 的精确 peer，执行 `npm install` 更新 lockfile。运行 `npm run test:player`、产品 Node/客户端测试、生产构建和实际 Worker／播放／离线浏览器回归；涉及音符、速度或定位时核对实际 MIDI 和小节边界。

## 分发和兼容

`npm run build` 会调用本地 `packages/player/scripts/copy-native-source.mjs`，校验原生 peer 和源码档案完整性，将源码及许可证追加到 `public/third-party/alphatab/`。已公开快照不可替换或删除，旧 PWA 客户端使用的版本资源继续遵守现有保留策略。

迁入时保持当前原生 tgz 和字体／音色不变，不改变用户数据、存储格式、附件字节、鉴权或播放协议。MPL 许可证和原作者通知保留；源码 URL 中原有提交标识是追溯信息，不是远程运行依赖。

## samepage.16：同次开谱复用已生成的 MIDI

原生 API 每次收到新 Score 时只自动生成一次 MIDI；同一调用栈及 synth 晚到的 ready 不再重复生成或载入。当前 API 内保留带 `midiLoad` 修正的 MIDI、tick shift、同步点和移调信息，synth 就绪后仅接收当前有效结果。tick lookup 仍在开谱时立即建立，包括禁用播放器的场景。显式 `loadMidiForScore()` 继续强制重建；播放器模式变更会重新准备，结束销毁会释放该准备结果。这不是跨练习会话的可变播放器缓存。

受控覆盖层新增完整 `AlphaTabApiBase.ts`、`AlphaSynthWebWorkerApi.ts` 和 16 项实际 API／generator／wrapper／synth 回归，覆盖两种就绪顺序、自动模式、快速换谱、显式重建、MIDI 修正、同步点、移调与销毁后的迟到事件。Worker API 的 `loadedMidiInfo` 返回私有状态，修复上游 getter 自递归，保证尚未加载 MIDI 时订阅 `midiLoaded` 以及加载后的即时状态订阅都安全。钢琴共享击键修正仍使用公开 `midiLoad` 接口，候选钢琴谱所需的独立校正生成保持不变。

## samepage.17：合并双标与 MIDI 准备

此制品完整保留已合入的 samepage.15 同音符 accent／strong-accent 与 tenuto 共存，以及 samepage.16 的单次基础 MIDI 生成和 Worker MIDI 状态 getter 修复。生成的 Note JSON／clone 字段与源谱双标测试一并保留；没有选择旧制品覆盖新显示能力。版本只更新本地固定原生依赖、精确 peer 和源码分发身份，历史 `.15`、`.16` 包与公开源码快照保留。

## samepage.18：整合 main 的括号音头修复

保留 main `c015021e` 发布的 native16 制品与全部音头源码，同时保留本 PR 的 MIDI 生命周期修复。上文 samepage.16 的 MIDI 说明指本 PR 历史候选，不能用来标识 main 的正式 native16；历史公开源码快照不变。当前组合制品为 native18。


## samepage.19：练习节拍与跳转预备拍 · #575

原生 synth 按分母拍打高／低木鱼拍声，首拍重音、复拍子三拍分组次重音。MIDI 每个小节写入拍号元数据，使弱起和反复后的拍点重置在真实小节边界；小节内变速按同一时间轴重新计算拍点。
预备拍读取寻址目标（含边界同刻的拍号与速度），暂停时重置预备序列并保留主音乐位置。`PositionChangedEventArgs` 新增预备拍次、总拍数、序号与完成标记；Worker 原样传递，谱面游标不跟随预备的独立 tick。会话据序号隔离连续寻址的旧回调。
新增 `PracticeRhythm` 实际 sequencer/synth 回归；更新 MIDI 装饰音测试对重复小节元数据的处理及变更拍声的 PCM 参考。完整原生测试与未修改基线均有同样的 64 个既有基线失败，当前 1860 项通过（基线 1857），无新增失败。相关 68 项音频测试全部通过。

## samepage.20：休止符位置历史控制（被 samepage.22 修正取代）· #559

MusicXML `<rest>` 的完整 `display-step`／`display-octave` 通过 `Beat.restDisplayStep` 保留为显示用自然音级坐标（C0=0、E4=30）。按 [W3C display-step 定义](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/display-step/) 原 native20 仅按谱号种类定位，遗漏了 clef-octave-change；该合同与相关完整性结论已由下节 native22 修正。percussion 谱号按普通 G4 treble 解释，不套用调号、发声移调或独立 octave-shift 方向。显式位置保留原休止和独立声部，不交给自动碰撞算法移位或合并；无位置、位置不完整或无效时沿用默认布局。

JSON／生成的 clone 传递可选显示字段；旧 JSON 缺字段时默认 null，旧客户端可忽略新字段。只改显示，不改音符、时值、力度、MIDI 或小节边界。11 种默认休止的 SVG 与 MIDI／位置 JSON 已和 native19 逐字节核对一致；原谱明确位置的休止会按源声明改变显示，不能把这种变化当默认布局回归。

完整原生测试为 **1885 通过、64 失败、1 跳过**。这 64 项与原候选失败名单逐名一致，仅移除了本次三项已解释的预期差异，包含 62 项既有视觉参考失败及两项 AlphaTex round-trip 来源元数据差异；不代表完整测试绿色。只更新了 `partwise-staff-change` 的两处源 D5 坐标快照及 `02b-Rests-PitchedRests`、`22d-Parenthesized-Noteheads` 两张经源文件和实际图核对的参考图，没有放宽比较器或全量接受 golden。最终制品仍需按上文流程通过实际播放器准备链、Worker 双布局和产品回归。

保留 native19 及更早固定制品、已公开源码档案与许可证；此次构建的旧控制产物也保留在独立目录，不以新包替换历史来源。旧20包及已公开源码档案保留，21留作独立琶音控制；本次休止修正使用新版本22，后续琶音集成计划23。

## samepage.22：休止符遵守当前时点的八度谱号 · #559

显式休止坐标同时使用 `getClefAt(beat.displayStart)` 与 `getClefOttavaAt(beat.displayStart)`，按八度谱号作 ±7／14 个自然音级的显示换算。G8下移谱号的中线是 B3，B4 应在其上方整八度；不能改 XML 坐标来补偿旧20的遗漏。percussion 始终按普通 G4 treble，不叠加 clef octave；instrument transpose 和独立 beat ottava 不参与休止定位。

初始 `clef-octave-change=2` 的枚举同时从误用的15mb改为15ma，与既有 timed 路径一致。修正该显示谱号枚举也会纠正此特殊输入的音头显示八度；输入音符 realValue、播放事件和时序不变。模型、JSON字段与旧默认休止路径不变。

当前源码定向休止测试50通过、1个外部谱probe跳过，覆盖 G/F ±1/2八度、两布局、时点变更、percussion、独立transpose/ottava、旧JSON/clone及MIDI。旧20的1885/64/1是历史控制结果，不能当成22的全套结果；新22固定制品、完整原生与产品/Worker门槛由后续构建验证补齐，不在源码测试阶段宣称完成。
