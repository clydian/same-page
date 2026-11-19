# MusicXML 声部自选音色验证

产品提交：8eb22d5；基于 main 6430689。证据独立保存，不属于产品文件。

## 可复现结果

- `verify.mjs`：真实生产构建的 SamePage React UI、本地 Worker/D1/R2、正常上传并打开双声部 XML 与两乐章 MXL；Chromium 156，1024×900 / 390×844。
- 单曲：默认收起无逐行下拉；展开编辑 Soprano；钢琴→哦声→使用谱面音色；Alto 的选择不变。暂停更换保留第5小节位置；循环第4–8小节、Soprano 独奏保持；播放中换啊声后恢复播放。
- 合集：第一曲哦声、第二曲啊声，切回第一曲仍是哦声；恢复原音色保留第2小节。
- `actual-midi.json` 与 `opus-midi.json` 为真实送往 AlphaSynth Worker 的 MIDI，而非 UI mock。`check-midi.mjs` 核实另一通道完整事件不变，单曲及第一乐章恢复后的全部事件与首次加载严格相等。第二曲 Piano/Alto 没有显式合唱上下文，原音色为0/0；这是当前播放器原有处理，未改。
- 确定性产品测试：两个声部各有两个谱表、program/bank automation；仅一个声部跨谱表改变，另一声部与另一曲不变，恢复后全部原事件/谱面模型/XML bytes 完全一致。
- 截图已实际打开查看：默认收起、展开、更换后、窄屏和第二乐章。沿用现有颜色、边框和控件；只在混音内增加一条默认收起入口。

## SoundFont 实际输出

`render-sounds.mjs` 使用安装包的真实 sonivox.sf2（SHA256 4978cf37e7164206f2d22dc4fdf4020ffe040787210bf781e31bdc79961f59ef）和 AlphaSynth，渲染同音高、力度、时长的 Piano 0 / Choir Aahs 52 / Voice Oohs 53。三个 WAV 都有有效、互异的 PCM，数据见 sounds.json。没有仅按 GM 名称推断整个包可用。WAV 可用于人工试听；本次未宣称完成真人主观音质验收。

## 检查与边界

- 播放器测试395项通过（含新主路径1项）；现有客户端循环测试6项通过。
- lint、typecheck、生产build、预缓存审计、git diff --check通过；最终补充的 MIDI seek回复隔离已重新编译、真实浏览器验证并单文件lint。
- 只保留当前打开会话、当前乐章、声部的选择，关闭后重新开谱恢复原有自动音色；不写源XML、准备结果、离线原件、存储或服务端。
- 换色短暂暂停并重新加载当前MIDI，恢复tick、循环与混音；不是无缝实时program override。试听时未做物理设备、Safari/WebKit、PWA、全预设、所有谱面或完整Worker回归验收。
- #680仍未合并。没有UI/功能依赖；整合预检查仅ready判断/歌词effect相邻行与测试adapter相邻行产生机械上下文冲突。没有实际合并、修改或提交#680分支，没有部署。
