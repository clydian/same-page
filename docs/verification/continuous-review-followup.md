# PR #479 / #480 再审查与 Ctrl+点击修正

> 2026-10-22：当前文件链接 CI 责任已按 [#535 门禁收敛说明](../operations/ci-file-link-contract.md)调整。下文保留历史诊断及当时验证事实；三次冷标签 PDF 和纯 HTML 60 次压力检查已撤下，不再作为当前门禁要求。#490 的加载停滞根因仍未确认。

审查起点：#479 `4e76d74`、#480 `8e6dcb7`。两者保持 draft，未合并、部署或写生产数据。重新读取 conversation、review submissions 和 review threads，均为空。检查预算回收/排队取消/后台恢复/旧异步结果，跨页持久化/撤销/失败保留，以及 owner/session/workspace/layer 权限边界，预算、持久化和权限未发现新的阻断项；最终 CI 另暴露并修正了隐私页加载切换的返回按钮竞态，见末节。新增旧 getPage 在文档替换或卸载后不得绘制、替换画面或重新占预算的测试；#480 另补双页协调不得绕过只读层的测试。

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


## 隐私页返回：真实按钮在 lazy 内容切换中被替换

最终 head60fda23 的 run39350272398/job118392628969，WebKit 在 direct privacy access 的前置步骤点击返回后仍停在/privacy，等待/drives超时。对应 artifact12232628985 的 clientBuild=e8cc414c24ba2774dcd3f71d6897cc49eed43eb2，已实际读取 GitHub refs/pull/479/merge 核对：它的两个父提交为 main9015197 与 PR head60fda23，归属正确。原 trace 精简，只有/privacy document-created/pageshow、click API返回及最终/privacy；没有输入或 handler 记录。marker尚未设置，不能据此推断reload，也没有Vite full-reload证据。

源码使用空root加createRoot，不是服务端按钮的hydration问题。隐私页模块是lazy导入；RouteContent的Suspense fallback和已加载PrivacyPage都各自渲染一个同名标题和TaskHeader。原测试等到标题时，可能仍是fallback。原生click过程中的稳定性检查并不保证pointerdown后DOM永不替换。

本地用真实浏览器把privacy-page.tsx请求保持pending，先在fallback返回按钮上mouse.down，再释放模块并等正文出现，然后mouse.up。修前旧按钮isConnected=false，文档收到down/up但没有click，URL仍/privacy；随后新按钮的正常点击立即到/drives。同一新增回归在临时还原产品修正后确定以“The pressed return button must survive content loading / false !== true”失败。此因果控制定位了真实可复现的handoff缺陷；原CI未记录输入，因此不声称还原了其唯一内部事件顺序。

最小产品修正把/privacy的TaskHeader和privacy-page外框交由路由持有，放在Suspense之外；lazy模块只提供政策正文。RouteContent新增默认开启的showHeader选项，隐私页关闭其fallback副本，其他页面默认行为保持原约定。返回按钮在pending、正文成功和正文失败之间保留同一个DOM节点，直接修正用户点击被丢弃的窗口；没有通过推迟测试点击来避开它。

原footer测试的goto(domcontentloaded)、heading、click、waitForURL及后续键盘/同文档断言全部保留。另为Chromium和WebKit各增加pending-content及content-handoff两种控制：前者在模块仍被阻塞时点击返回；后者让模块在mouse.down/up之间完成，断言原按钮仍连接并成功到/drives。输入标签/生命周期元数据加入原失败证据记录。组件测试另验证模块加载失败后仍只存在一个标题和原返回按钮。

本地Chromium三个相关浏览器用例通过，相关组件33项通过；修前控制日志和修后结果保留于artifacts/verification/privacy-header-handoff/。固定WebKit的最终结果以同步后的CI为准。未重跑旧失败作为结案依据，未放宽原导航时限或断言。


## 浏览器测试分片预算

修正隐私页后，run39352906919 的 smoke(1) 37项通过、0失败，但总时长361140.69ms触及原6分钟步骤上限；同一提交的另一分片317227.08ms。先将不使用Worker、存储或应用的纯HTML modifier-tab回归移入visual-report浏览器交互套件，恢复原存储文件分配。原生Page事件5秒限制、60次逐次断言和证据采集全部保留。旧后端对照命令为`SAME_PAGE_MODIFIER_CHANNEL=shell node --test visual-report/modifier-tab-readiness.test.mjs`。

这一归属修正不足以解决总预算风险。随后两个完整成功run39354213509/39354214387的smoke各63项通过，但分片分别346.605/320.135秒、343.696/292.130秒：整套总负载约636–667秒，即使二分片完全均衡也要318–334秒，距360秒仅26–42秒。因此不再以单次全绿或仅重新平衡两个分片结案。

逐文件汇总两次CI的顶层用例耗时，使用每文件较慢样本，最重为musicxml-playback约59秒、preview-notes约50秒、practice-compare约43秒、file-touch-links约41秒；不是单个用例接近超时。按现有Node原生排序轮转分为三片，预计用例负载228.5/158.8/251.1秒，另有进程启动开销。完整smoke改为三个原生分片，仍保持max-parallel=2、单片顺序执行、6分钟步骤上限及12分钟job上限。只有两个文件的已审计library范围继续两个分片，避免空分片。

6分钟是整套分片的总步骤预算，12分钟job还包括checkout/npm/浏览器安装及artifact；它们与每个用例的既有60–240秒截止时间不同。本改动不延长任何预算或用例时限，不增加retry，不减少断言/覆盖。多一个full-suite job有一次npm/浏览器环境准备成本，并可能增加总墙钟等待；不增加同时运行的job或同Worker fixture内的并发。直接共享有状态Worker/D1/R2 fixture会改变隔离与冷启动覆盖，为本次修正引入更大风险；静态耗时权重表则需要长期维护。三个既有原生分片是维护负担更小、且有实测负载依据的方案。

实际runner回归覆盖二/三分片、增加新文件后每文件恰执行一次且无遗漏/重复；library保留两文件范围。最终两head的完整CI及实际三分片耗时另记录于PR和交付证据；不通过重跑旧失败覆盖证据。
