# iOS MusicXML 静音模式播放

## 行为与边界

MusicXML 使用 alphaTab / SONiVOX，经 Web Audio 输出。用户主动请求播放时，
播放器尝试声明 `navigator.audioSession.type = 'playback'`，不修改系统音量，
不改变现有手势解锁。暂停、自然结束、失败和退出时恢复先前类别；内部预览恢复
和寻址后的实际播放也重新声明。若其他音源随后选择了不同类别，退出时不覆盖它。

接口缺失、拒绝或忽略设置时继续原有播放。仅在 iPhone/iPad 尝试播放后显示：

> 此设备在静音模式下可能无法播放练习音频。若无声，请关闭静音模式并检查媒体音量。

按实际能力检测，不按 iOS 版本字符串硬编码。网页无法据此读取静音开关位置，
因此提示不声称设备已经静音。非 iOS 不显示此提示。保留音量、静音、独奏等现有控件。
浮动提示约 8 秒后收起，也可立即关闭；悬停或键盘焦点在提示内时暂缓收起。
同一次练习不因暂停、继续、寻址或切换谱面重复弹出。收起后仍可在「练习设置」查看说明。
不增加循环静音媒体文件，也不承诺锁屏或后台持续播放。

## 依据

- [WebKit #237322 comment 6](https://bugs.webkit.org/show_bug.cgi?id=237322#c6)：
  工程师说明 iOS 17 起可用 playback 避免静音开关消音。
- [Apple Playing audio](https://developer.apple.com/design/human-interface-guidelines/playing-audio.md)：
  主动发起的媒体播放允许在静音模式下出声，系统音量仍控制最终输出。
- [W3C Audio Session 工作草案](https://www.w3.org/TR/audio-session/)：playback 属于
  排他音频类别，可能暂停其他媒体音频，须实机检查；API 的默认 type 是 auto。
- [WebKit #261554](https://bugs.webkit.org/show_bug.cgi?id=261554)：后台暂停曾有独立回归，
  不把本次静音模式改动当成后台播放保证。

## 自动与实机验证

`playback-audio-session.test.mjs` 覆盖惰性申请、重复申请、恢复先前类别、外部类别变更、
API 缺失/抛错/忽略设置、iPad 桌面身份及非 iOS 降级。
`session-behavior.test.mjs` 覆盖请求先于 synth 播放，暂停/失败/退出释放，
以及 Worker 旧暂停回调后重新进入播放的恢复。
`browser-tests/musicxml-audio-session.test.mjs` 在 Chromium/WebKit 中用受控 AudioSession
适配器和实际产品播放器验证播放、暂停、继续、退出及兼容提示；适配器不模拟物理静音开关。
已有 `musicxml-audio-startup.test.mjs` 验证初始化中暂停或退出没有延迟出声。

本次 Cloud 验证：生产构建（含类型检查）、ESLint、363 项 player 测试、138 项 playback
客户端测试通过。上述两个浏览器文件的 Chromium 用例通过（含暂停/退出/返回三个子用例）。
WebKit 已下载安装，但启动被环境缺少 `libgtk-4.so.1`、`libgraphene-1.0.so.0`、
`libharfbuzz-icu.so.0`、`libmanette-0.2.so.0`、`libhyphen.so.0`、`libGLESv2.so.2`
阻塞，未执行产品断言，不能称为 WebKit 通过。环境无 sudo 或 scoped package installer；
普通 apt 下载也因无可用索引而未完成。可在已安装 Playwright 系统依赖的 CI 中执行同一命令：

```sh
node --test --test-concurrency=1 browser-tests/musicxml-audio-session.test.mjs browser-tests/musicxml-audio-startup.test.mjs
```

真实 iPhone 尚待验收，自动化有信号不能替代设备听觉验证。需分别测试 Safari 和主屏幕 PWA：
静音开/关、媒体音量零/非零、首次播放、暂停继续、预备拍、循环/范围预览、初始化中退出、
其他音乐并播、耳机断开、来电及锁屏返回。至少包含实际支持的旧 iOS 和当前稳定版本。

2026-11-13 提示生命周期修正：新增 `playback-audio-hint.test.tsx`，验证 8 秒收起、
手动关闭、同 session 重渲染不重新弹出、新 session 可提醒、悬停与焦点暂缓。
播放客户端 141 项通过，生产构建/类型检查及定向 ESLint 通过；Chromium 产品回归确认
自动收起、暂停继续不重现、练习设置仍可查阅。当前改动的 WebKit/CI 结果以后续运行记录为准。
另见 [常驻提示审查](persistent-notice-review.md)，其中其余提示也已按最新清理记录处理。

## 旧版本占比参考（2026-11-12 查询）

[iOS 17 于 2023-09-18 发布](https://www.apple.com/newsroom/2023/09/ios-17-is-available-today/)。
低于该基线通常指 iOS 16（2022）及更早，仍可关闭静音后播放。
[iOS Ref](https://iosref.com/ios-usage) 于 2026-11-03 更新的 Statcounter 汇总给出
iOS 17 及以上累计 95.5%，反推旧版本约 4.5%。这是全球 iPhone+iPad 网页流量份额，
不是设备保有量，也不是合谱用户统计。Statcounter 的 UA 识别及流量采样有局限，
故只宜视为约 4–5% 的量级，不能直接用作机器覆盖率。
