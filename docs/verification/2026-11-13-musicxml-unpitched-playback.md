# 无映射念白的播放修复 · #647

## 原因和处理

MusicXML `<unpitched>` 的 display-step/display-octave 是符头位置，并非需要合成的旋律音高。原导入路径把没有 midi-unpitched 声音映射的音符落到默认 MIDI 0，导致《下班快乐！》末段32个念白产生极低音。

导入器现在区分“明确且有效的 midi-unpitched”与缺省映射。无映射时使用既有 articulation 的 outputMidiNumber=-1 内部哨兵，MIDI generator 在逐音发声及音效生成前跳过。谱面、歌词、时值、小节定位保持，不替换音高、不删除源音符。未写 note/instrument 的无音高音符使用 part 默认乐器。显式 MIDI 0（MusicXML值1）、其他合法映射和普通有音高 MIDI 0 仍然播放；不是全局屏蔽低音键。

沿用已有 articulation JSON/clone 字段，无新增持久化字段或数据库迁移。源附件字节不变；旧 PWA 客户端只有更新到包含 native24 的版本后才获得修复。

## 固定制品

- native：1.8.4-samepage.24
- 包 SHA256：`4bde140c41d3393a99485491e50e680beb6462cdda2f225efcee3f979451c7c6`
- 源提交：`25440aca858f0451ec17e30e082b534282552409`
- 源码档案 SHA256：`e598b6f9223a3d7da6ef93fc5792fedaa1c14012782caada3072d1c1246a26c0`

历史包和已公开源档案保留；此次只增加新版本，不覆盖线上旧快照。

## 核心验证

`packages/player/test/unpitched-playback.test.mjs` 的17项测试覆盖：无映射念白、JSON round-trip、缺省/显式乐器、明确打击乐映射（含 MIDI 0 和正号整数）、非法映射、同一和弦混合发声/静音音头，以及分页/横向两种布局。静音谱与已映射对照的 SVG 完全一致，节拍和歌词仍在，正常音符的位置不变。

正式 prepare → structuredClone → load → 声道分配 → MIDI generation → 钢琴共享键修正链，对三首真实候选再次验证：

| 候选 | 旧起音 | 新起音 | 结果 |
|---|---:|---:|---|
| 借 v4 | 843 | 843 | 全部 MIDI 事件精确不变 |
| 无名的人 v21 | 2626 | 2626 | 全部 MIDI 事件精确不变 |
| 下班快乐！v67 | 3866 | 3834 | 恰好移除32个无映射起音、32个对应音尾和32个逐音中性 bend reset；没有新增事件，其余事件全部精确不变 |

原32个念白音头仍在模型内；结果不是删谱、捏造旋律或事后过滤所有 MIDI 0。实际候选内容不提交仓库，只记录哈希与统计，见 `musicxml-unpitched-real-score.json`。没有实际主观听验，不把 MIDI 检查当作耳听。

## 工程检查和边界

最终固定包 player 380项通过；产品 Node单测380、客户端1433、typecheck、lint和生产构建通过。原生全套1955通过、64失败、1跳过；与同环境实际运行的 native23 逐名对照，64个失败完全相同，无新增。失败清单见 `musicxml-unpitched-native-tests.json`，没有更新快照、删测试或放宽断言。

浏览器首轮缺少 Playwright 可执行文件，安装后 Chrome 的实际附件开谱/播放、prepare Worker、离线关闭冷启/刷新恢复和原生源码分发检查通过。WebKit 在启动前被宿主缺少 libgtk-4、libgraphene、libharfbuzz-icu、libmanette、libhyphen、libGLESv2 阻挡，不声称 WebKit 产品回归通过。未修改测试来掩盖宿主依赖缺失。

此修复仍需 PR 合并和实际部署；本地验证不代表线上已解决。没有调用生产数据库或发布三首附件。
