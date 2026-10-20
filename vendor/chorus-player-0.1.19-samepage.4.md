# player .4 / native .5 制品

该播放器来自 Chorus 已合并的完整源码基线，而非从旧 main 手工替换 dist：

- source-parity PR17 → `f6bf1bbd677d373fdb8456bb41f11bf13118dcf9`；
- Keyboard reduction PR18 → `dbc9af70743d03c9918ff6ebfeea67efc4549b32`；
- 固定依赖 PR19，审查 head `2fe85810f3679f16471acf1131d7b3e0b02c166d`，main
  `64d77de3e85e79d7db1a1dc9a2dad8a747c27b6c`。

播放器 tar SHA-256：`60f7a34334792919f394295518d8decdaec8655f1b902c86748d9ac397c4e7a1`。
原生 tar：`85af16c3f011ef3d51780fd1a62be2c52b1e8b51f60a338926cedfad129c5900`；
完整原生源提交：`6fb2eac48b8d98518c12f220e4a851b7b4594fed`，源码档案：
`68a48e0c10c5e932d671b95562d393e38ba6533e7f858902d3e7c76b21eb68c9`。

原生在 `.4` 上只有独立类型前置修复与跨声部反序延音修复。只解析同谱表/同小节、
相邻、唯一的有音高端点，不猜测装饰音、打击乐、间隙或竞争端点。公开 Worker JSON
先登记关联 ID，再逐声部完成连接。源码档案、完整 patch、MPL 许可和通知随包分发；
`copy:native-source` 发布新的内容寻址快照并预检现有文件，不删除旧下载。此前 `.4`
修改源码全量类型检查的错误摘要已撤回；新的独立干净构建全量类型检查通过。

播放器保留 source words/wedges、seek/follow、小节标签和 AudioWorklet 取消行为，
只增加完整 `Keyboard reduction` 名称（可选原谱 `(for rehearsal only)` 后缀）这一
窄声部别名；GM0/bank0、通道、轨道、起点和不同乐器的保护保留。源 XML 和显示名称
不改。源声部/乐器属性不明确的其他命名不因默认 program0 被一概当成钢琴。

## 重建与检查

在固定 Chorus 源提交上以 Node24 执行 `npm ci --ignore-scripts`、
`npm run build:player`，然后 `npm pack --ignore-scripts --workspace=@clydian/chorus-player`。
原生使用 `scripts/package-native-alphatab.mjs`，固定上述源提交与版本 `.5`；脚本独立
clone、干净安装并构建 ESM/UMD/Vite/Webpack，检查生成源码无漂移，保留许可和全部
修改源码。构建产物 checksum 应单独核实，不以私有仓库 URL 代替源分发。

正式两个 tar 在独立最小宿主经干净 npm ci；33 份冻结输入的所有 MIDI 字段、
小节边界和音符网格与当前 `.3/.4` 一致。Sun 冻结键盘组件只发生两类已定位修正：
去除跨声部错误起音/释放及重复同键起音/短释放，另去除错误起音对应的一条中性弯音
复位；其余所有事件顺序和值、70 小节边界和 681 个原符头保留。569 个物理键攻击/
最大保持释放与冻结期望一致，不代表该曲其余源谱疑点已裁定。

真实浏览器 prepare Worker → native render Worker 完整定位舟中98/Come62/Sun70
小节与2小节自有用例。舟中34个、Come12个 SVG 与 `.3/.4` 实际 Worker 基线逐字节
相同；新两小节延音停在正确的各自小节内。未以 MIDI 自洽或能打开替代全曲原谱认证，
也没有声称经过耳听。
