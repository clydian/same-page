# MusicXML 开谱优化 · #551

工作从 `de7d2639e9bb44808b1fc154db14d4e31bc73ddd` 开始，保留 native14 谱面修正；实施期间整合主分支 `c3c36656` 的 native15 双标修复，最终组合版为 native17。相对最新 main，本 PR 不包含其 admin 或数据库迁移改动。研究基准见 [方案](../research/2026-10-22-musicxml-startup-optimization-plan.md)；其中 native13 原型计时与当前实现验证分别记录。本次不涉及数据库升级、原附件修改或服务端 API 变更。

## 实现边界

- 准备 Worker 返回最终可导入 XML、印刷小节标签和显式格式标识；保持 direction → ties → repeats 顺序，旧 payload 继续回退，未知显式格式由原文重做。
- 活跃会话持有 prepared，最后释放后才计算闲置 TTL；闲置条目仍受数量、字节与 LRU 限制，归属和清理围栏仍生效。每次明确打开依旧新建初始状态的练习会话。
- 每个当前 Score generation 生成一份 MIDI 与定位数据，晚到 synth 载入当前结果；显式 `loadMidiForScore()` 保留强制重建。
- 每次新鲜 metadata 授权后按 prepared → 同修订本地原文 → 锁 revision 的网络选择来源。同次打开合并在途 metadata，focus 重新核实。真正离线仍要求原有目录、保留 PDF 权限、完整壳与资源验证。
- 自动原文保存及公共资源准备等待可播放和首个可读系统；原文保存不再依赖整包成功。相同公共字节可按目标 SHA/size/MIME 跨 build 复制，不改旧 URL 或退休规则。清单保留实际字体 fallback，排除运行时未引用的 EOT/SVG/metadata 文件；部署仍保留这些文件。
- 阶段指标只写现有本地有界日志，不含文件名、谱文或身份。首个可读系统与 ready 分别记录，播放请求与实际 playing 分开记录。

## 可执行检查

使用 Node 24：

```sh
npm ci --prefer-offline --no-audit --no-fund
npm run lint
npm test
npm run build
node --test --test-concurrency=1 browser-tests/musicxml-startup.test.mjs browser-tests/musicxml-playback.test.mjs browser-tests/musicxml-audio-startup.test.mjs browser-tests/musicxml-offline.test.mjs
```

`musicxml-startup` 使用自有 48 小节谱验证真实构建的 network/prepared/local 三条来源、每次新开一次 metadata、一次 MIDI，以及加载完成前切换 PDF 仍能达到 ready、返回 XML 后完成真实首个系统与原文保存。首个系统按音乐渲染事件和真实 bounds 确认，不把标题 SVG 或特定 path 元素当作音符已出现。`musicxml-playback` 验证实际 Worker 协议、MXL、音乐修正、控制和非零 WebAudio，并按 animation frame 记录实际点击至首个非零 analyser 样本的延迟；数字输出测量不等于物理扬声器的声学延迟。产品 `playing` 只表示播放状态，早于 AudioWorklet 初始化完成，不作为声音终点；`musicxml-audio-startup` 覆盖暂停/结束/离开时取消初始化，`musicxml-offline` 覆盖完整壳、闭浏览器冷开、刷新与失权撤销。

## 验证状态

浏览器与 final-head CI 结果以 [PR #555](https://github.com/clydian/same-page/pull/555) 的最新检查及 CI artifacts 为准。测试输出位于本工作区 `artifacts/verification/`，只包含合成测试谱。原型数值不作为实体设备结论。

- 最终 native17：制品 SHA-256 `594eeff31aeb762c19b4d2b2d2de89227cb73dc4045fd8999a817a4d98720aca`，源码提交 `9bcd697196c3f55ee21eeadb2b823e9b138482bb`，源码档案 SHA-256 `e0e405e96f9f425f4278f22dce9ab1ac12676a167b9aa71f5168b9929a278a1e`。[精确差异](musicxml-startup-native17.patch)与[测试及安装审计](musicxml-startup-native17-tests.json)：163 项定向（含 24 双标及 16 生命周期）、TS/lint 通过；fresh15 1825 pass / 64 fail，native17 1841 pass / 64 fail，逐项相同的 64 项失败，无新增失败。645 个安装文件匹配制品，历史包及 68 个公开源码／许可证文件不变。
- 最终 native17 的 player 338 项通过；Sun／Jesu 的完整模型及全部 MIDI 事件与旧准备路径一致，原文字节不变。原生全部失败已保留，不称全量通过。
- 中间 native16 制品 SHA-256：`d1905cb0063b819358fe71a2c239478cc6e7e0c74653d7f94a45034234d053a7`。源码提交 `acb735a64769e1ea9d6bbbcdcdd31ec30fa9e448`，源码档案 SHA-256 `0d70a8c3ddf938d14fdfe01a4ed6e5c3e31e896d750900d72086850faa99dea1`。
- Native14 → native16 的[精确源码差异](musicxml-startup-native16.patch)及[完整测试对照](musicxml-startup-native16-tests.json)：新增 16 个生命周期测试通过，139 项相关回归通过；全量 1817 pass / 64 fail，与 fresh native14 的 1801 pass / 64 fail 逐项相同。64 项既有视觉 golden 差异保留，未改 golden 或声称全量通过。
- 两份私有真实谱 The Sun Never Says（5 声部、70 小节）与 Jesu, meine Freude（5 声部、441 小节）：中间 native16 下新旧准备路径的完整模型及全部 MIDI 事件 deepEqual，原字节不变；谱文未提交。
- 中间本地 `npm test` 的 player 338 项、Node 305 项通过；默认客户端并发下有 13 个界面等待超时。保留日志，不把受控重跑通过当作根因修复；最终客户端结果与 final-head CI 另列。

### 浏览器测试环境与数据契约

`f93f20e5` 的真实构建浏览器检查发现 WebKit 原文保存失败。独立探针确认本地步骤合计 38 ms（捕获 30 ms），原文保存已启动，失败是 IndexedDB 写入 Blob 的 `UnknownError: Error preparing Blob/File data to be stored in object store`。Playwright 1.62.1／macOS arm64 25.4.0／WebKit 26.5（rev 2336）下，非持久 `browser.newContext()` 可写 object／ArrayBuffer／Uint8Array，但七种 Blob／File 均失败；改用独立临时目录的 `launchPersistentContext()` 后全部十种写入成功。因此，验证持久原文的启动测试使用持久用户目录并在结束后清除；产品存储代码、250 ms 预算、清理围栏与失败提示不作放宽。此浏览器环境差分不等于实体 iOS／Android 验收。

普通音频的资源检查改为关闭 XML 页后，独立新页从导航前记录所有请求及错误，继续禁止 XML 引擎、alphaTab、soundfont，并增加 `.sf2` 检查。原 CI 的 sanitized trace 没有网络记录，不能证实当次 Chromium 失败来自哪个请求；旧测试在 XML 仍活跃时开始计数，存在把后台资源准备纳入新文档统计的窗口。修正后 Chromium／WebKit 的真实启动测试 2 项通过，包括全部 network／prepared／local、每次一个 metadata／MIDI、原文保存、关闭前 XML 错误检查及新音频页全生命周期资源／错误检查。

同轮 CI 的 practice-focus 失败来自旧视觉 fixture：文件响应缺少真实 API 的 `X-Attachment-Revision`，且仅覆写密集谱 body 导致 metadata size 不匹配。修正为 metadata 与响应共用同一 XML 输入及其 UTF-8 字节数，保留产品一致性校验及原视觉断言。旧 fixture 的修订／大小检查先失败；修正后的 fixture 单测 2 项、Chromium／WebKit 的实际 practice-focus 各 1 项通过。

## 独立 review

### Standards

`144b9772` 初轮 1 项 P1：本地初始读取超时后惰性 writer 重新捕获清理围栏，会在用户清理之后迟到自动写回。修复禁止丢失原围栏的会话自动写入；明确重试才建立新意图，并在等待新鲜 metadata 前开始捕获围栏。验证使用真实 fake-indexeddb 与 `clearLocalFiles`，不只 stub guard。

### Spec

`144b9772` 初轮 2 项 P2：完整离线准备链仍重复审计整包；playing 未覆盖点击至真正音频输出。前者限定复用本任务刚完成的公共包验证，未来独立离线读取继续全审；后者增加真实浏览器的 click → 首非零 analyser 样本计时，并保留 playing 的状态语义。

`99415618` 两路独立复核均无遗留发现：Standards 重跑 3 文件 52 项通过；Spec 确认两项 P2 关闭。main 整合范围已独立复核：相对 `c3c36656` 无 admin／迁移改动，native15 全部双标源码、测试和历史制品保留；native17 的来源与完整回归另见上列固定摘要。

清理围栏与同任务审计的新增回归先在修复前得到 4 fail，修复后全部通过。
`musicxml-cleanup-intent.test.tsx` 使用真实 IndexedDB 原文与 `clearLocalFiles`，覆盖
本地超时后网络／Worker 晚到不自动恢复已清理原文、明确重试可以建立新意图，以及
重试 metadata 等待期间再次清理必须拒绝。`offline-musicxml.test.ts` 从完整
`prepareOfflineMusicXml` 链验证不重复调用公共包审计；后续独立离线读取仍审计资源，
资源缺失会拒绝认证。公开读取 API 没有跳过校验的开关或长期信任缓存。

实体 iPhone/iPad 已安装版、Android 已安装版的 p50/p95、峰值内存、后台恢复与音频路由验收尚未进行；本 PR 不宣称已解决这些设备上的全部等待，也不创建整套播放器常驻或完整 Score 持久缓存。合并与部署另行授权。
