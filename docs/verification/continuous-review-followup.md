# PR #479 / #480 再审查与 Ctrl+点击修正

审查起点：#479 `4e76d74`、#480 `8e6dcb7`。两者保持 draft，未合并、部署或写生产数据。重新读取 conversation、review submissions 和 review threads，均为空。检查预算回收/排队取消/后台恢复/旧异步结果，跨页持久化/撤销/失败保留，以及 owner/session/workspace/layer 权限边界，没有新发现的产品代码阻断项。新增旧 getPage 在文档替换或卸载后不得绘制、替换画面或重新占预算的测试；#480 另补双页协调不得绕过只读层的测试。

## 修前证据与定位

原始失败 run `39339439020` / job `118357384314` 没有该步骤 trace，补跑通过不构成修复。重新保留原 5 秒时限后，两份最终 head CI 均再现 Chromium 故障：

- run `39347015757` / job `118382688819`：Ctrl 事件已送达，ctrlKey=true/defaultPrevented=false；目标 document GET 200；不同 frame 后续请求 reader、session、sync、PDF worker、PDF 和笔记，但没有 context.page 事件。
- run `39347019265` / job `118382808366`：第一次真实新页和 PDF 内容验证通过；第二次新页初始 about:blank，document GET 200；toHaveURL 等到目标导航后再次卡在 pending navigation，最终超时。WebKit 均通过。父任务已下载并解析对应两份 trace；先前本环境 artifact 文件代理 403 不再作为停工条件。

继续在 `0415216` 增加只读原始 target/frame 观察，run `39349229043` / job `118389571015` 再次在第一笔 Ctrl+点击等待 context.page 超时。该次失败给出了更强证据：

- 输入/点击完成约 55ms；5 秒后 context.pages 仍只有初始 about:blank 和原文件库页。
- 同一浏览器上下文的原始 Target.getTargets 已有第三个 attached page target，URL 为准确的目标乐谱、title 为合谱。
- 通过独立 CDP 会话读取该 target：Page.getFrameTree URL 正确，document.readyState=complete、visibilityState=visible、正文为乐谱及翻页控件，两个 data-pdf-canvas-active 的 canvas 都是 390×504。
- 浏览器为 HeadlessChrome/151.0.7922.34，Playwright 1.62.1。整个观察不激活目标、不发送导航或 debugger-resume，失败前仅记录 target 元数据。

因此该次超时定位到测试后端对新 target 的初始化/观测；应用已打开并运行阅读器，Playwright 未把它报告成可用 Page。不能再把它归因为点击被应用拦截、未发正确请求或 PDF 没有初始化。两个较早 trace 的具体阻塞 await 尚未独立证明相同，不把 200 单独当作页面可用证据。

## 最小修正与验证

[Playwright 官方 issue #42142](https://github.com/microsoft/playwright/issues/42142) 记录了相同版本、背景新标签已运行但 Page 事件缺失的故障；其中协议调查定位到首次导航 commit 的初始化等待，仍是开放上游问题。此报告用于交叉印证，不替代本项目的 CDP 证据。

仅将原生标签页用例的 Chromium 启动方式设为 `channel: 'chromium'`，选择同一 Playwright 安装包中的完整浏览器 / new headless。使用方式见[官方浏览器文档](https://playwright.dev/docs/browsers#chromium-new-headless-mode)。CI 既有安装命令已下载该二进制；SDK、浏览器版本及业务行为不作升级。其他用例的后端和 WebKit 不变。

保留真实 Ctrl+点击、新标签事件、目标 URL、原页未跳转和实际 PDF 像素校验；每个用例连续检查三次，每次都必须通过。另加纯 HTML 的 60 次原生 modifier-tab 测试，排除应用、Service Worker、存储及 PDF 引擎；每次检查新页数量、目标 URL、目标内容和原页 URL。每次 page 事件仍限 5 秒，任何一次失败都使测试失败，无 retry。设置 `SAME_PAGE_MODIFIER_CHANNEL=shell` 可在同版本二进制下运行旧后端基线，默认使用 full Chromium。

本地系统 Chromium 154 的原应用三次真实 PDF 路径及纯 HTML 60 次均通过（分别约 19 秒和 6 秒）；本地 CDN 拒绝固定 151 二进制下载，不能将本地 154 当作同版本对照。固定 Chromium 151 与 WebKit 的最终结果以各自 CI head 为准。实体 Android/iOS、Pencil、软键盘和后台内存回收不属于这些桌面模拟结果。

失败证据长期保留为 trace、截图、输入取消状态、点击和导航时序、原始 targets/frame/runtime 快照；关键 JSON 同时写入 CI 日志。TAP 会转义日志中的反斜杠，读取内嵌 JSON 时需还原该 stdout 编码。采集器另用受控 preventDefault 取消验证：事件分发后的 task 才能正确读到最终 defaultPrevented；capture listener 内的 microtask 可过早读到 false。该采集修正与原新页故障分别记录。
