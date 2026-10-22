# Same Page alphaTab 维护

日常开发直接使用 `vendor/coderline-alphatab-1.8.4-samepage.16.tgz`；不编译原生引擎，不需要 Chorus 或其他私有仓库。播放器源码在 `packages/player`。

## 修改并重建

- `SOURCE-MANIFEST.json` 记录迁入基线：公开上游 `022a45c8e42370f9e12e68949d11eada370da83d`、原修改源提交、树及文件校验值。它是历史基线，不是后续编辑文件的校验清单。
- `changes.patch` 从该公开上游恢复完整修改树（包括新增、删除及二进制变更）。
- `modified-source/` 保存完整修改文件、原生测试及其测试输入，作为本仓库可直接编辑的覆盖层。新增修改文件按上游相对路径放入此目录；需要删除文件时同步调整补丁。

使用 Node 24，修改 `modified-source/` 后，在仓库根目录执行：

```sh
npm run build:native -- --version 1.8.4-samepage.17 --output /tmp/same-page-native-17
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
