# 文件打开区域的触摸交互（#470）

## 范围与行为

文件库（搜索、排序与最近打开共用 `ScoreLink`）及本机存储使用同一个
`FileOpenLink`。它仍渲染真实链接，保留现有 `href`、辅助名称、键盘激活、
修饰键与鼠标右键。文件操作继续使用原省略号菜单；长按没有新增操作。
外链附件、正文、导航、搜索框、表单、编辑器及阅读器不使用此组件。

仅明确报告 `pointerType: touch` 的 `contextmenu` 被取消；未知、鼠标、笔与
键盘来源保留原行为。iOS 的 `-webkit-touch-callout` 仅限这些链接；
文字选择限制仅在链接的触摸序列进行期间生效，不用设备媒体查询推断输入来源。

触摸移动达到 10px、出现多个接触点、取消或按住达到 500ms 会撤销本次点击。
时长在松手/点击时检查，没有长按计时器，也不拦截 pointerdown/touchstart、
捕获指针或修改 touch-action。撤销先于离线准备回调。下一次 pointerdown 或
键盘输入恢复普通激活；短触摸的延迟兼容 click 不重新按等待时间判为长按。
普通重渲染保留本次撤销，目标变化撤销旧触摸，卸载后不留下全局监听器。

## 验证与自审

- 锁文件安装：Node 24，`npm ci --no-audit --no-fund`。
- `npm run lint`、`npm run typecheck`、`npm run build`。
- 全量 Node 单元测试 192 项、客户端测试 1083 项通过；最后补充的保护用例再由
  针对性客户端测试验证（file-open-link、prepared-score-link、score-link、local-storage-page）。
- 单元覆盖：菜单与松手/取消不同顺序、无菜单事件、重复操作、无尾随 click、
  移动/双指/取消、延迟短点击、鼠标/笔/未知来源、键盘/辅助技术、修饰键、
  目标变化、重渲染、卸载及不启动离线准备。
- `browser-tests/file-touch-links.test.mjs` 使用本地隔离 Worker 夹具；验证真实页面的
  链接、外链、搜索框、省略号/Escape 焦点、正常打开及本机存储入口。
- 本地 Chromium 154 通过 Playwright/CDP 输入验证按住不打开、下一次点按恢复、
  原生滚动与双指不误打开、右键不被取消、Ctrl 点击打开新标签页及键盘 Enter。
  检查按住/滚动期间没有 PDF 或笔记准备请求。
- 自审检查最终 diff：产品变化限于共享链接组件、其局部 CSS 和两个接入点；
  无全局事件/选择限制、无菜单项/权限/存储协议变化、无阅读器或播放器修改。

## 兼容边界

浏览器的 contextmenu、pointercancel、pointerup、click 顺序不统一；应用事件测试
不证明系统菜单被真机隐藏。未知来源的菜单保守放行。

云环境下载 Playwright 配套浏览器被代理以 `403 Domain forbidden` 拒绝；本地使用
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium`。WebKit 用例交由正常 CI；
其 held sequence 是 DOM 事件回归，不能算 iOS 原生手势验收。

尚未完成 Android 已安装 PWA、iOS Safari/主屏幕 PWA、TalkBack/VoiceOver 真机验收。
旧平台若不提供 Pointer Events 或明确的来源，不能承诺消除所有原生菜单。
