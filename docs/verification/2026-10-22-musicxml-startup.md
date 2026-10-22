# MusicXML 开谱优化 · #551

工作从 `de7d2639e9bb44808b1fc154db14d4e31bc73ddd` 开始，保留已合入的 native14 谱面修正。研究基准见 [方案](../research/2026-10-22-musicxml-startup-optimization-plan.md)；其中 native13 原型计时与当前实现验证分别记录。本次不涉及数据库升级、原附件修改或服务端 API 变更。

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

`musicxml-startup` 使用自有 48 小节谱验证真实构建的 network/prepared/local 三条来源、每次新开一次 metadata、一次 MIDI，以及加载完成前切换 PDF 仍能达到 ready、返回 XML 后完成真实首个系统与原文保存。首个系统按音乐渲染事件和真实 bounds 确认，不把标题 SVG 或特定 path 元素当作音符已出现。`musicxml-playback` 验证实际 Worker 协议、MXL、音乐修正、控制和非零 WebAudio；`musicxml-audio-startup` 覆盖暂停/结束/离开时取消初始化，`musicxml-offline` 覆盖完整壳、闭浏览器冷开、刷新与失权撤销。

## 验证状态

实施中的记录；最终结果、native 制品身份和独立 review 将在提交前补齐。测试输出位于本工作区 `artifacts/verification/`，只包含合成测试谱。原型数值不作为实体设备结论。

实体 iPhone/iPad 已安装版、Android 已安装版的 p50/p95、峰值内存、后台恢复与音频路由验收尚未进行；本 PR 不宣称已解决这些设备上的全部等待，也不创建整套播放器常驻或完整 Score 持久缓存。合并与部署另行授权。
