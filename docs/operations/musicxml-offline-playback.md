# MusicXML 离线播放

在线打开 MusicXML/MXL 时，播放器按需准备公共资源，并保存原始附件字节。
普通访问、安装应用壳和主 PDF 下载不会预装播放器大包。

- 构建输出版本化的 `playback/<buildId>/manifest.json`、字体和 soundfont 根目录；
  JS/worker/worklet 采用 Vite 内容哈希 URL。共享 JS/CSS 由已校验的应用壳提供。
- manifest 自身进入 shell 完整性清单。可选资源逐项校验长度、SHA-256 和 JS/CSS MIME；
  不下载未使用的 `sonivox.sf3`，保留播放器实际使用的 `sonivox.sf2`。
- Cache Storage 只保存可公开的资源。统一保存已解码响应，去除传输编码和 `Vary`；
  字体、worklet 与普通 fetch 的请求头差异不会造成离线缓存未命中。
- 原始字节使用现有 IndexedDB `system` store 中的 `offline-musicxml` 命名记录和 Blob 字段，
  不升级数据库版本、不改写 PDF/笔记数据。键包含 owner、云盘、乐谱、附件和修订。
- 激活写入同时检查本机工作空间 epoch、导航身份、附件目录拒绝标记、文件清理 fence、
  logout fence 和 AbortSignal。退出删除受保护原文；清理文件仅移除对应范围。
- 只有匹配的完整 shell、资源、原文、附件目录和已验证的主谱离线阅读条件同时满足，
  才显示“此练习谱可离线打开与播放”。没有主谱的完整离线副本时不作此承诺。
- 完整失败或中断保留旧内容；公共资源重试只补齐缺失/损坏项。prepared 对象仍仅保留在
  原来的有界内存缓存里，不保存速度、位置、混音或声部设置。
- 缓存中的目录是显示元数据。断网或暂时服务故障可使用验证后的原文；401/403/404
  明确拒绝不会回退。阅读器刷新后，缺少附件计数的 retained PDF 可读取最后保存的目录。
- 公共资源回收复用 #466 对活跃页面、worker、回退壳和宽限期的保护，不能触及业务存储。

## 验证

新增 `browser-tests/musicxml-offline.test.mjs` 使用持久 Chromium profile：
上传 XML/MXL、确认就绪、关闭整个浏览器、断网启动、从目录进入 MXL、谱面实际渲染、
非零音频采样、暂停、速度/声部设置、刷新、从阅读器进入 XML、再次实际出声和暂停；
随后注入附件 403，验证当前原文被清除、其他原文和 PDF 保留。
截图输出到 `artifacts/verification/musicxml-offline/`。

构建单测验证资源 URL 隔离、静态依赖闭包及共享依赖去重。存储与资源测试覆盖
中断、重复准备、版本不符、损坏/被清除的缓存、配额失败、清理、退出 fence、
切换用户后返回、导航重置和迟到写回。既有 MusicXML 浏览器测试同时覆盖 Chromium
与 WebKit 的 Worker、声部、循环、实际音频、速度和 PDF 切换。

本地命令：

```sh
npm run lint
npm run typecheck
npm run test
npm run build
node --test browser-tests/musicxml-offline.test.mjs browser-tests/musicxml-playback.test.mjs
npm run test:pwa-update
```

本地浏览器为 Linux 系统 Chromium 154、Playwright WebKit 26.5。
Playwright Chromium 的 CDN 下载受限，测试使用系统 Chromium；WebKit 的缺失依赖解包到
临时目录后运行，没有修改应用依赖或部署系统。真实 iOS Safari/已安装 PWA 的杀进程、
后台回收、音频路由及系统存储淘汰仍需真机验收，不能由桌面 WebKit 结果代替。

共享播放器现有 AudioWorklet 初始化期间，极快地“播放后立即结束/暂停”可能触发
未 start 的 AudioBufferSourceNode.stop 异常。此 PR 未修改原生播放器制品；本次播放
验收在确认真实音频输出后暂停及测试失权清理，不将这个既有初始化竞态视为已修复。
