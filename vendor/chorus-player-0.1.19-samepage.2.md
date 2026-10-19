# AudioWorklet 初始化取消修复（#434）

本次固定组合为 player `0.1.19-samepage.2` / native `1.8.4-samepage.3`，仅作为
SamePage 本地制品使用，未向上游仓库或 npm 发布。

## 原生改动与来源

- 原生源提交：`a67e8a34112faeaccf1fc2b019cf7b580ada73de`，源树
  `4cc1fb3e04e1217d967bf6ccccf47e348ce43cb1`。
- 精确保留 `.2` 源快照 `d917b3e3faa5f64e1c524f9a41af19b537bf3a49` 的所有渲染、
  导入与 MIDI 代码。与该快照仅相差一个运行时文件和一个回归文件；增量见
  `patches/alphatab-1.8.4-samepage.3-audio-startup.patch`（零上下文，重放使用
  `git apply --unidiff-zero`）。
- 新源提交将既有 SamePage 修改及本次修复收敛在公开上游
  `022a45c8e42370f9e12e68949d11eada370da83d` 之上；完整重放 patch 为
  源码档案中的 `changes.patch`。不是上游正式版本或已发布提交。
- 原生包 SHA-256：`bf6a6ceefcd1f4732b648ee87d2fb648db30980bbad9e76767da98270c7ffdd9`。
- 包内完整修改源档案 SHA-256：
  `bd177deaf51464d0483a55202409920c5ce89709d447e32098c5efba23e1912d`。
  `alphatab-1.8.4-samepage.3.manifest.json` 记录文件散列、源树、工具版本和制品清单。

`AlphaSynthAudioWorkletOutput.play()` 在异步初始化前同步启动空白 buffer 的静音
source，使基础 `pause()` 在初始化期间也可合法调用 `stop()`。异步回调捕获本轮的
context/source，仅在二者仍属于当前播放时连接 worklet 和转交缓冲事件；暂停、销毁、
再次播放后的旧回调不会创建节点、连接新一轮 source 或消耗新一轮事件。不引入等待，
不捕获并吞掉 `InvalidStateError`，也不禁用暂停。

## 构建与分发

使用 Node 24.22.0，在独立原生仓库中检出上述源提交，执行：

```sh
node scripts/package-native-alphatab.mjs \
  --native-repo /path/to/native-source \
  --commit a67e8a34112faeaccf1fc2b019cf7b580ada73de \
  --version 1.8.4-samepage.3 --output /path/to/empty-output
```

本仓库的脚本来自固定 Chorus 源快照 `68934362feef46b24c55372c8c91f813acb97cc1`。
它独立 clone、按锁文件安装、执行原生/打包插件构建，验证生成代码未改变源快照，
保留完整修改文件、重放 patch、MPL 许可和通知。没有该本地 Git 提交时，可从公开
上游基线应用源码档案中的完整 `changes.patch`，核对 manifest 内所有修改文件散列与源树后再创建本地提交；
新的提交和构建时间会改变制品字节，应另行记录散列，不冒称位级可重现。

Player 从现有 `clydian-chorus-player-0.1.19-samepage.1.tgz` 解包，只将 `package.json`
的 version 改为 `0.1.19-samepage.2`、精确 native peer 改为 `1.8.4-samepage.3`，再执行
`npm pack --ignore-scripts`。其余 42 个文件逐字节不变，包含准备、MIDI、Session、
跟随/经过标签扩展及 source-copy 脚本。Player 包 SHA-256：
`7d51d40634864959276e8619333d7332331792cab33e63f0fa92885c4ea91e12`。

宿主仍只有一个 native 实例。每次 build 的 source-copy 校验精确 peer 与源档案散列，
将新源码公开在内容寻址的 `/third-party/alphatab/` 路径；保留旧快照，不改业务存储、
prepared payload、MusicXML、MIDI 或 Worker 协议。

## 回归

原生 `AudioWorkletLifecycle.test.ts` 覆盖初始化前暂停/销毁、暂停再播放的新旧完成
顺序、缓冲事件归属和正常清理。旧源 5 项中 4 项失败，新源 5 项通过；既有共享符头、
源力度位置和歌词位置回归一并通过（合计 24 项），TypeScript 6.0.3 检查通过。

宿主 `musicxml-audio-startup.test.mjs` 用真实浏览器的实际 `addModule()`，只控制其
完成时序；分别取消为暂停、结束和返回文件库，确认迟到完成不会创建 worklet。暂停后
再播放须有实际非零音频采样。`admin-workbench.test.mjs` 另保留不加初始化阻塞的
立即暂停/重播和播放后立即切换比较结果，并继续等待真实音频后验收正常暂停。自动化不是手机真机或人工听验。
