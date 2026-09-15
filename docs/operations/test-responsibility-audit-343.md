# 测试责任清理 · #343

## 基线与范围

基线 `1cc4ecd72d6c2b173e8ecac1e37b6d03af7399fc`。扫描 180 个测试文件及非 test 命名的验证入口，按声明、断言、调用实现和领域约定判断。下面是逐文件责任，不把静态审查冒称为对每条测试做过错误注入。

清理集中于外部传输/惯性时序、装饰实现、重复浏览器业务链和手工构造的优化比较；未改变产品行为、数据库或客户端数据。A/B 编号对应 [#343](https://github.com/itscly2026/same-page/issues/343)。

## 新测试的判断规则

- 先说应用自己的哪种错误会被检出，以及用户会损失什么；只回答“库应该这样工作”的不建立门禁。
- 没有独立价值就删除，不要求一删一补。领域状态/失败组合在最低可靠层维护；浏览器保留实际输入、布局、用户激活、持久化和发布资源接线。
- 信任 PDF.js/XHR 的公开回调；用受控边界验证转换与生命周期，不制造大文件/限速/惯性阈值。不把已 mock 的能力称作真实系统验收。
- 装饰不固定像素/DOM 形状；坐标、可达性、安全区、三等分点击区和保存/身份/版本约定有产品意义。遵循 ADR-0010/0013，不将自有节点保留或 canvas CSS 接线误删成“库测试”。
- 重复测试比较的是独立故障边界，不是名称是否相似。无需把删除的门禁挪到定时 CI，不增加全局重试或超时。

## 收敛后的关键保障

| 责任 | 所在层 |
| --- | --- |
| 进度未知/已知、100% 不能结束打开、当前 canvas ready 才结束 | 新 `src/client/routes/reader-opening.test.tsx` 使用真实 ReaderPage/ReaderSession/PdfPageCanvas，只控制 PDF 引擎和网络 |
| 引擎进度映射及取消/迟到回调 | `pdf-document.test.ts`、`reader-document-cache.test.ts`、`reader-presentation.test.tsx` |
| 上传完成不等于保存成功 | `upload-transport.test.ts`、`upload-dialog.test.tsx`、`pdf-version-dialog.test.tsx` 的受控回调 |
| 原生手势不被覆盖层破坏 | `reader-immersive` 纵向按住移动；`reader-navigation` 横向实际翻页 |
| 原谱/笔记输出、用户激活、未打开谱的导出 | `pdf-export`、`pdf-share`、`prepare-export`；前两者分别断言阅读器/文件库入口默认图层选择 |
| 真实 decoder/Worker/SW 与离线重启 | codecs/storage/offline-entry/PWA 测试；缺失 API 的注入前提仍验证 |

B5 的笔记节点身份保留、C 的 Clipper 洞/岛映射和隐藏 canvas CSS 均核对实现后保留。它们是应用自己做的适配/约定，不属于库的无条件保障。B8 保留 continuous-reader-layout 的偏好页返回、reader-zoom 的双击锚点和 reader-settlement 的 pinch 回弹：入口与故障不同，不能以纸面几何都出现就删掉。

## 逐文件处置（基线 180 个文件）

### src

| 文件 | 处置 | 独立风险或剩余保障 |
| --- | --- | --- |
| `src/client/annotations/annotation-editor.test.ts` | 保留 | 连续写入、失败重试、撤销与旧会话隔离，防止丢失最新编辑意图 |
| `src/client/annotations/annotation-overlay.test.tsx` | 保留 | 文字、形状、画笔的实际编辑入口、取消、落盘失败与编辑层隔离；坐标属于笔记数据，不能按装饰像素删除 |
| `src/client/annotations/annotation-refresh.test.ts` | 保留 | 失权、共享层变更、跨谱响应与锁/租约隔离，防止旧结果恢复已撤销内容 |
| `src/client/annotations/guest-notes.test.ts` | 保留 | 本机体验不进入账号 outbox，刷新保留且用户/谱子之间隔离。 |
| `src/client/annotations/highlighter-geometry.node.test.ts` | 保留 | 自行实现的覆盖沉积、回描叠色与 twist 映射；与库布尔运算不同。 |
| `src/client/annotations/highlighter-regression.node.test.ts` | 保留 | 自交回归、精度/PolyTree 洞岛适配、顶点工作预算与安全降级。 |
| `src/client/annotations/ink-geometry.node.test.ts` | 保留 | SVG/导出/命中共用页面坐标和产品画笔语义。 |
| `src/client/annotations/local-annotations.test.ts` | 保留 | OCC、opId 幂等、未确认写入与重启后的草稿保留 |
| `src/client/annotations/note-interaction.test.ts` | 保留 | 取消与手势交接保留已提交笔迹、撤回未释放的操作。 |
| `src/client/annotations/outbox-recovery-coordinator.test.tsx` | 保留 | 前台/联网事件合并与用户切换后停止扫描 |
| `src/client/annotations/outbox-recovery.test.ts` | 保留 | 不同谱独立恢复、失败隔离、有界扫描与调度公平性 |
| `src/client/annotations/sync.test.ts` | 保留 | 真实本地 outbox 与传输的衔接、丢回执重放及删除顺序；与本地 reducer 测试的接缝不同 |
| `src/client/annotations/use-annotation-editor.test.tsx` | 保留 | React 生命周期刷新不会丢掉失败编辑或打开的编辑会话 |
| `src/client/app.test.tsx` | 保留 | 真实路由组合、认证/邀请入口及组件接线；不机械删除所有与下层状态测试同名的场景 |
| `src/client/auth/auth-client-cleanup.test.ts` | 保留 | #230 新增：真实 session 监听器在环境销毁前卸载，受控时钟检出延迟清理泄漏 |
| `src/client/auth/drive-entry.test.ts` | 保留 | 访客、成员和公开体验准入意图，不因登录自动扩大成员关系 |
| `src/client/auth/logout-local-data.test.ts` | 保留 | 用户确认前后草稿清理、跨用户隔离与迟到身份响应 |
| `src/client/auth/offline-entry.test.tsx` | 保留 | 首次断网/会话失效时本机可达性，缓存不成为云端授权 |
| `src/client/auth/preview-guest-session.node.test.ts` | 保留 | 公开体验会话按云盘和退出路径清理 |
| `src/client/auth/session-fetch.node.test.ts` | 保留 | 旧会话响应不能覆盖新登录身份 |
| `src/client/auth/session-recovery.test.tsx` | 保留 | 应用有界重试、前后台与在线门槛、身份确定后停止。 |
| `src/client/components/app-header.test.tsx` | 保留 | 通过帮助进入诊断而不刷新丢失内存中的故障记录 |
| `src/client/components/invite-link.node.test.ts` | 保留 | 邀请码留在 fragment、异常输入拒绝及往返完整性 |
| `src/client/components/join-code-field.test.tsx` | 保留 | 完整输入规范化与单个可访问输入；装饰槽位 aria-hidden 防止重复朗读，不是外观断言 |
| `src/client/components/reload-prompt.test.tsx` | 保留 | 离线/失败重试和已准备版本与运行版本区分 |
| `src/client/components/route-content.test.tsx` | 保留 | 模块加载失败的重试、退出及阅读器加载阶段入口 |
| `src/client/diagnostics/diagnostic-submission.test.ts` | 保留 | 用户主动提交、丢回执幂等、隐私与身份代际 |
| `src/client/diagnostics/diagnostics-page.test.tsx` | 保留 | 诊断展示/清除、过期、回执及用户切换 |
| `src/client/diagnostics/diagnostics.node.test.ts` | 保留 | 诊断白名单、HTTP/PDF 错误分类和不泄露异常正文 |
| `src/client/diagnostics/local-operation.test.ts` | 保留 | 本机异常安全分类、原异常保留及旧身份事件过滤 |
| `src/client/drives/trial-actions.test.tsx` | 保留 | 身份 fence、配额失败与破坏操作前明确确认。 |
| `src/client/install/install-provider.test.tsx` | 保留 | 应用对安装事件的一次性消费、取消与手动引导；不测试浏览器安装器内部 |
| `src/client/navigation/navigation.test.tsx` | 保留 | 先关闭覆盖层、等待可靠落盘、保留显式目的地和未保存表单 |
| `src/client/offline/offline-lifecycle.test.tsx` | 保留 | Blob 校验、配额回滚、版本/身份竞态、文件清理与快照完整性 |
| `src/client/offline/offline-preparation.test.ts` | 保留 | 共享准备任务、取消与期限、跨谱 Blob 故障隔离；直接覆盖 #221/#223 风险 |
| `src/client/performance/loading-performance.node.test.ts` | 保留 | 阶段关联与无身份信息的诊断输出 |
| `src/client/platform/local-database.test.ts` | 保留 | 真实 Dexie 版本升级保留文件、快照、草稿、outbox 和冲突 |
| `src/client/platform/local-identity-observer.test.tsx` | 保留 | 相同用户重新激活仍需新代际，观察者不能复活旧会话 |
| `src/client/platform/local-workspace.test.ts` | 保留 | 升级/切换的原子性、访客与用户隔离和跨标签失效 |
| `src/client/platform/migrate-brush-styles.node.test.ts` | 保留 | 旧 IndexedDB 笔迹迁移保留离线数据、outbox 内容和 OCC 基线。 |
| `src/client/pwa-navigation.node.test.ts` | 保留 | 应用壳导航规则不能把 API 当页面缓存 |
| `src/client/reader/export-dialog.test.tsx` | 保留 | 导出准备失败/身份失效有退出与重试，不重复生成。 |
| `src/client/reader/foreground-deadline.test.ts` | 保留 | 自有前台计时、隐藏期间暂停及取消后不恢复执行。 |
| `src/client/reader/local-pdf-download.test.tsx` | 保留 | 本机下载校验身份/版本并释放 URL，晚到任务不能跨目标。 |
| `src/client/reader/pdf-background.test.tsx` | 保留 | 自有 canvas 双缓冲在隐藏、上下文丢失和晚到渲染时的生命周期。 |
| `src/client/reader/pdf-document.test.ts` | 删除部分 | B1：保留回调转换、任务取消/晚到 fence；删除 rangeChunkSize 实现常量耦合。 |
| `src/client/reader/pdf-page.test.tsx` | 保留 | 应用管理双 canvas 的交接，不能清空仍在显示的位图 |
| `src/client/reader/prepare-export.test.ts` | 保留 | 未打开乐谱的导出准备使用准确版本和允许的本机笔记，不上传草稿。 |
| `src/client/reader/reader-annotation-actions.test.ts` | 保留 | 保存/重试意图可靠落盘和退出后的结果隔离 |
| `src/client/reader/reader-auto-offline.test.ts` | 保留 | 自动准备任务跨阅读器生命周期取消与显式下载保留 |
| `src/client/reader/reader-document-cache.test.ts` | 保留 | 同版本复用、释放、资源上界、失权及错版拒绝；不是 PDF.js 自身单测 |
| `src/client/reader/reader-layer-panel.test.tsx` | 保留 | 分享范围、订阅/编辑隔离、个人层创建幂等与未同步删除保护 |
| `src/client/reader/reader-navigation.test.tsx` | 保留 | 自有 pan→翻页交接、反向与 pinch 取消；不依赖物理惯性。 |
| `src/client/reader/reader-opening.test.ts` | 保留 | 诊断记录真实阻塞阶段，替换失败恢复旧文档的已呈现事实。 |
| `src/client/reader/reader-presentation.test.tsx` | 保留 | 真实 canvas 呈现适配与 session：旧页/缩略图不能确认当前页，失败可恢复。 |
| `src/client/reader/reader-reopen-tracker.node.test.ts` | 保留 | 冷/暖/重开诊断分类的身份及缓存到期规则 |
| `src/client/reader/reader-runtime.test.ts` | 保留 | 保留取消后不预加载的调度行为；删除只检查 modulepreload 标签的伪网络证明 |
| `src/client/reader/reader-session.test.ts` | 保留 | 源码选择、显示确认、期限/取消/重试与旧结果隔离 |
| `src/client/reader/reader-sync-status.node.test.ts` | 保留 | 可靠落盘和服务端确认的区别；状态文案影响数据安全判断，保留 |
| `src/client/reader/reading-preferences.test.ts` | 保留 | #228 新增：持久化选择、最后意图胜出、旧刷新/跨身份隔离、覆盖继承及无锁时不误发 |
| `src/client/reader/sync-reader.test.tsx` | 保留 | 组合同步的一次性请求、取消、owner fence 与禁止闲时轮询。 |
| `src/client/reader/use-continuous-reader-layout.test.tsx` | 保留 | 自有连续页定位、延迟元数据与缩放/viewport 的提交先后。 |
| `src/client/reader/use-drive-reading-preferences.test.tsx` | 保留 | 云盘订阅意图与远端确认的竞态，不覆盖本谱显式选择。 |
| `src/client/reader/use-last-tool.test.tsx` | 保留 | 工具与新文字默认值的本机持久化和 owner 隔离。 |
| `src/client/reader/use-paged-reader.test.tsx` | 保留 | 应用自己的翻页、编辑锁页、边缘输入与取消规则 |
| `src/client/reader/use-reader-gestures.test.tsx` | 保留 | 保留应用坐标、取消及 redraw 交接；去掉 CSS 自定义属性值和精确测量调用次数 |
| `src/client/reader/use-reader-preferences.test.tsx` | 保留 | 按用户/乐谱记住布局与位置，避免跨身份或版本串用 |
| `src/client/reader/use-reader-taps.test.tsx` | 保留 | ADR-0010 自有单击/双击仲裁的时间、位移与取消门槛。 |
| `src/client/reader/use-reader-workspace.test.tsx` | 保留 | 身份准备超时与 late response fence，不能把旧捕获恢复成新权限。 |
| `src/client/reader/use-reader-zoom.test.tsx` | 保留 | 自有 zoom lease、延迟布局、旧 handle 和退出清理。 |
| `src/client/reader/use-tool-color.test.tsx` | 保留 | 按用户和工具隔离颜色记忆 |
| `src/client/routes/auth-page.test.tsx` | 保留 | 登录/注册/恢复的实际 UI 分支、失败和继续目的地 |
| `src/client/routes/drive-management-page.test.tsx` | 保留 | 成员只读查看与修改权限分离，不提前请求敏感凭据 |
| `src/client/routes/home-entry.test.tsx` | 保留 | 首次访问、显式首页意图、成员选择、公开体验及旧身份响应 |
| `src/client/routes/leave-drive-page.test.tsx` | 保留 | 退出成员身份与页面返回区分，保留未同步数据并明确确认 |
| `src/client/routes/local-storage-page.test.tsx` | 保留 | 取消与本机文件清理结果，不能误删云端或草稿 |
| `src/client/routes/membership-management-page.test.tsx` | 保留 | 权限编辑冲突、保存成功刷新失败、授权范围与双视图草稿 |
| `src/client/routes/reader-page.test.tsx` | 保留 | 真实路由接入文档/权限/本地工作区，保留错版、失权、超时、旧响应和离线编辑 |
| `src/client/routes/shared-layer-details-page.test.tsx` | 保留 | 保存确认与后续读取失败分开、冲突不丢草稿。 |
| `src/client/routes/shared-layer-management-page.test.tsx` | 保留 | #228 新增：暖缓存可看，权限刷新失败仍禁用删除，重试确认后才恢复操作 |
| `src/client/routes/user-lifecycle-page.test.tsx` | 保留 | 删除/恢复重新确认、草稿隔离和退出后迟到响应 |
| `src/client/score-library/drive-library-cache.test.ts` | 保留 | 缓存按用户隔离、拒绝恢复旧授权及安全诊断 |
| `src/client/score-library/drive-library-transport.test.ts` | 保留 | 登录过期与明确失权保持不同语义 |
| `src/client/score-library/drive-library.test.ts` | 保留 | 后台刷新与缓存/权限分别建模，返回位置一次恢复和并发响应隔离 |
| `src/client/score-library/drive-settings-dialog.test.tsx` | 保留 | 修订冲突保留输入，需要有意识地再次保存 |
| `src/client/score-library/invite-sharing.test.tsx` | 保留 | 邀请码恢复/轮换的产品语义，读取失败不视为没有原码。 |
| `src/client/score-library/local-library.test.tsx` | 保留 | 保留文件入口不构造成员身份，跨用户与失权后的本机可达性 |
| `src/client/score-library/offline-score-control.test.tsx` | 保留 | 校验完成才宣称离线可用、旧版保留、跨页面下载与失败重试 |
| `src/client/score-library/pdf-version-dialog.test.tsx` | 保留 | 预览及显式接受后才发布，关闭取消与回滚编号 |
| `src/client/score-library/save-invite-card.test.ts` | 保留 | 应用分享取消不下载、不支持才降级；不验证系统分享器 UI。 |
| `src/client/score-library/score-file-action.test.tsx` | 保留 | 未知写入不能盲重试，确认修改即使退出对话框也要持久化。 |
| `src/client/score-library/score-link.test.tsx` | 保留 | 未确认云端访问时链接不可用，权限恢复后解除产品限制。 |
| `src/client/score-library/upload-dialog.test.tsx` | 保留 | FIFO、失败隔离、未知结果不盲重试、配额和身份切换 |
| `src/client/score-library/upload-transport.test.ts` | 保留 | 受控 XHR 回调验证应用百分比/速率转换、保存确认、取消和不重放 POST。 |
| `src/client/score-library/use-drive-library.test.tsx` | 保留 | React 离开/重新接入时正确处理位置和身份缓存 |
| `src/client/settings/read-resource.test.ts` | 保留 | 共享读取的时效、owner/session 与变更依赖失效规则。 |
| `src/client/settings/settings-mutation.test.tsx` | 保留 | 自有写入串行与写后恢复、离开身份后忽略完成回调。 |
| `src/shared/annotations.test.ts` | 保留 | 删除仅接受合法 schema 形状的重复用例；Worker preference 路由保留 false/null/颜色更新，纯函数保留领域优先级 |

### worker

| 文件 | 处置 | 独立风险或剩余保障 |
| --- | --- | --- |
| `worker/android-release.test.ts` | 保留 | 产品 APK 路由的字节、元数据、范围请求和缺失发布时的降级。 |
| `worker/annotations-flow.test.ts` | 保留 | 真实 D1 上权限/OCC/幂等/跨谱层生命周期；保留长链路的事务关系与 N+1 增长检查 |
| `worker/auth-flow.test.ts` | 删除部分 | C：删除依赖随机两次 OTP 不同的库再生行为；保留自有注册转发、限流、身份保留和会话撤销。 |
| `worker/auth/principal.test.ts` | 保留 | 无 cookie 不加载认证服务、正确消费认证会话与访客优先级 |
| `worker/auth/social-providers.test.ts` | 保留 | 凭据不完整时不能公开启用 provider |
| `worker/diagnostic-reports.test.ts` | 保留 | 报告隐私、幂等/配额/保留期与失败时不假确认 |
| `worker/diagnostics.test.ts` | 保留 | 错误日志安全字段和日志失败不得影响请求 |
| `worker/email/send-otp.test.ts` | 保留 | 真实邮件服务响应契约；发送未确认时不能误报送达 |
| `worker/free-trial-flow.test.ts` | 保留 | 真实 D1 下配额/并发占位/删除回收与身份约束。 |
| `worker/index.test.ts` | 保留 | health 发布身份与未知 API 不落到 HTML 壳 |
| `worker/lifecycle-flow.test.ts` | 保留 | 拥有权唯一性、授权和提交间竞态、用户删除与恢复、草稿服务端边界 |
| `worker/performance/server-timing.test.ts` | 保留 | 应用诊断 header 固定阶段名与计时格式；稳定假时钟，保留低成本契约 |
| `worker/scheduled-cleanup.test.ts` | 保留 | 某清理失败不得阻断其他清理 |
| `worker/scores-flow.test.ts` | 删除部分 | A8：删除人为请求调度加权比较与唯一 measure-d1 helper；真实业务/权限/生命周期与导航去重保留。 |
| `worker/scores/pdf-validation.test.ts` | 合并 | A9：有效多页元数据合入原字节/digest 接入用例，不再单独测试另一份合法 PDF 的页数。 |
| `worker/security/rate-limit-cleanup.test.ts` | 保留 | 真实 D1 过期边界、并发续期、批量清理有界及安全日志 |
| `worker/security/security.test.ts` | 保留 | 应用邀请码采样无偏及签名访客 token 篡改/过期拒绝 |

### visual-report

| 文件 | 处置 | 独立风险或剩余保障 |
| --- | --- | --- |
| `visual-report/auth-methods.test.mjs` | 收敛 | B3：删除 mock OTP 错误/重试/返回反复业务链；保留不同真实 auth 布局状态的可达与不溢出。 |
| `visual-report/continuous-reader-layout.test.mjs` | 保留 | 真实连续布局退出偏好页后恢复位置，编辑切换不跳动；与缩放回弹是不同入口。 |
| `visual-report/diagnostics.test.mjs` | 保留 | 真实 PDF.js 403 与网络错误传到应用诊断；Node 错误 mock 无法替代接缝 |
| `visual-report/drive-library-lifecycle.test.mjs` | 保留 | 挂起后台响应证明缓存返回不等网络、滚动/输入不被刷新覆盖 |
| `visual-report/drive-navigation.test.mjs` | 保留 | 浏览器 history、焦点和应用滚动显隐规则；显隐属于应用，保留已隔离场景 |
| `visual-report/drive-settings.test.mjs` | 删除部分 | B2：删除 RadioGroup 的方向键/焦点内部循环；继续验证选择权限后显示正确成员与授权范围。 |
| `visual-report/highlighter-nib.test.mjs` | 保留 | 同一笔记的 SVG/PDF 实际像素、叠色和数据姿态接线；不是复测库几何。 |
| `visual-report/highlighter-regression.test.mjs` | 保留 | 已知自交与预算降级在真实页面仍可操作、不会全页失败。 |
| `visual-report/homepage-responsive.test.mjs` | 保留 | 保留两引擎最窄宽度、720/721 断点、宽屏及 200% 文字；删除设备商品预设重复和图文左右/上下顺序，保留实际遮挡与溢出 |
| `visual-report/layer-preferences.test.mjs` | 改写 | B8：参考层保留可见/淡化/只读语义，不固定 .45；保留编辑不写订阅、云盘默认与本谱覆盖的接线。 |
| `visual-report/navigation-freshness.test.mjs` | 保留 | 真实应用导航驱动请求去重；替代手工指定 before/after 次数的比较。 |
| `visual-report/pdf-export.test.mjs` | 保留 | 接回“取消全部”不改变阅读订阅的独立断言；保留源 PDF 几何与文字/墨迹/透明度保真、订阅范围及失权/离线拒绝 |
| `visual-report/pdf-share.test.mjs` | 保留 | 真实点击用户激活、取消后的文件复用与失效；系统分享器由 stub 代替。 |
| `visual-report/pencil-writing.test.mjs` | 删除部分 | A6/B5：删除整个悬浮装饰/姿态 browser case；几何层验证 twist/tilt。保留首笔、相交填充和保存时工具条不中断。 |
| `visual-report/quiet-export.test.mjs` | 删除 | B4：重复原谱/笔记下载、装饰位置和静默文案；prepare-export/pdf-export/pdf-share 分别保障准备、输出和激活；在已有 pdf-share 场景补充文件库默认图层选择，与 pdf-export 的阅读器入口对应。 |
| `visual-report/reader-annotation-stability.test.mjs` | 保留 | ADR-0010 明确要求切工具保留笔记节点及归一化几何，不是 React 的库承诺。 |
| `visual-report/reader-canvas-layering.test.mjs` | 保留 | 应用 CSS 可能覆盖 hidden 导致旧 canvas 遮住新画布；elementFromPoint 验证实际遮挡，不只是属性快照 |
| `visual-report/reader-experience.test.mjs` | 删除部分 | B8：删除重复 landscape fit 与写旧 safe-area 变量后期待原尺寸的测试；reader-settlement/reader-immersive 保障实际几何和安全区。 |
| `visual-report/reader-immersive.test.mjs` | 改写 | 缩放交接检查纸面/笔记中心与字号比例，移除变换预览与提交字号后文字边缘完全相等的约束； 删除 2 个精确惯性场景，换 1 个触点按下期间的原生滚动集成检查；保留原生 pinch、错位/编辑锁页与 safe-area；真实批注 pinch 取代手拼 HTML 预览比较；删除圆角断言 |
| `visual-report/reader-mobile-editing.test.mjs` | 保留 | 同一阅读器 resize 取代 7 次重开；保留可达/不重叠/触控区域、编辑和双击回归；删除 12px、中心点对齐和 textarea rows/overflow 实现 |
| `visual-report/reader-navigation.test.mjs` | 改写 | A3：只保留横向 native touch 到实际翻页；纵向原生触摸由 reader-immersive 保障，删除惯性距离/事件取消探针。 |
| `visual-report/reader-opening.test.mjs` | 删除 | A1/B1：半流字节门禁撤掉；routes/reader-opening.test.tsx 验证真实页面进度和绘制交接。 |
| `visual-report/reader-presentation.test.mjs` | 保留 | 真实虚拟列表恢复后实际页可见，前后台和 context loss 的 canvas 接缝。 |
| `visual-report/reader-scrubber.test.mjs` | 删除部分 | A5：删除 0px 边框；保留实际选页、键盘与取消拖动及非溢出。 |
| `visual-report/reader-settlement.test.mjs` | 保留 | 短/长纸面、分页/连续/编辑的原生边界与 pinch 回弹；保留最少不同布局的接缝。 |
| `visual-report/reader-status.test.mjs` | 收敛 | B8：保留真实 history.back 遇 IDB 失败不丢文本及重连恢复；删除每个阶段来回 resize 的布局矩阵和重复 PDF 失败返回链。 |
| `visual-report/reader-text-layout.test.mjs` | 删除部分 | A7：删除直接写 textAlign 后测浏览器算法；保留产品 CSS 下不自动换行、比例与实际触控热区。对齐持久化/导出另有保障。 |
| `visual-report/reader-zoom.test.mjs` | 保留 | 双击和 pinch 锚点提交、对象手势归属及 PDF/笔记对齐；不与纯 fit 回弹混同。 |
| `visual-report/reading-state.test.mjs` | 收敛 | B8：只保留真实双标签未确认订阅串行；删除手机重复、显示名往返和静默文案。显示名草稿由 drive-settings-dialog 保证，窄屏由独立布局测试保证。 |
| `visual-report/responsive-navigation.test.mjs` | 保留 | 保留真实键盘导航、长文件名、溢出、触控和文件信息；去掉工具栏固定位置、旧帮助入口不存在等排版断言 |
| `visual-report/safe-area.test.mjs` | 保留 | 应用 CSS 的安全区裁切、sticky header 和真实 portal 控件可达。 |
| `visual-report/ui-polish.test.mjs` | 合并/改名 | A4/B8：layer-panel-layout 仅保留真实窄屏图层控件可达；删除居中/等宽/行形状及重复文件库回流矩阵，后者由 drive-library-lifecycle 与 DriveLibrary 保障。 |
| `visual-report/ui-simplification.test.mjs` | 保留 | 只保留权限编辑/授权分离、受托范围、移除取消及弹窗键盘；移除重复的用户设置、阅读器选项、分享、导出、本机存储和默认成功截图 |
| `visual-report/uiux-return.test.mjs` | 保留 | 导航/成员筛选、表单决定、阅读偏好返回、帮助深链各自独立页面；移除品牌 class 断言及成功截图 |
| `visual-report/update-safety.test.mjs` | 保留 | 表单失焦后和提交中仍不能热更新；等待越过应用 3 秒空闲阈值有业务意义，不能按 sleep 一律删除 |
| `visual-report/upload-queue.test.mjs` | 删除部分 | A2：删除上传/替换×双浏览器的四组 12MB 限速代理场景；受控 transport/dialog/version tests 保留进度/保存确认。小文件真实表单到请求仍保留。 |
| `visual-report/ux-refinement.test.mjs` | 收敛/改名 | B8：shared-layer-management 只保留真实排序按钮和详情表单接线，删除 href、无 textbox、重复 reload 与字面形状。 |
| `visual-report/visual-report.test.mjs` | 保留 | 未知 fixture 请求拒绝外发、报告 HTML 转义；基础设施失误影响隐私/可信证据 |

### browser-tests

| 文件 | 处置 | 独立风险或剩余保障 |
| --- | --- | --- |
| `browser-tests/access-smoke.test.mjs` | 保留 | 真实不可变 PDF 替换、旧离线版在失败时保留、过期回收项不可恢复 |
| `browser-tests/android-install-smoke.test.mjs` | 删除 | B7：安装提示和 release API 均已 mock；install-provider 覆盖同分支，真实 APK 路由和安装 handoff 独立保留。 |
| `browser-tests/annotations-smoke.test.mjs` | 保留 | 生产 API/真实 D1 与 IndexedDB 之间的离线和在途笔记保存 |
| `browser-tests/diagnostic-reports.test.mjs` | 保留 | 真实页面提交到 Worker 的回执、隐私和受控报告内容 |
| `browser-tests/free-trial-smoke.test.mjs` | 保留 | 真实注册/创建云盘、上传和删除配额的 UI→Worker→存储接线。 |
| `browser-tests/install-onboarding-smoke.test.mjs` | 保留 | 隔离浏览器的 cookie handoff 与冷启动，不是模拟安装器行为。 |
| `browser-tests/invite-entry-smoke.test.mjs` | 保留 | 真实邀请自动准入与用户/访客/已加入成员路径 |
| `browser-tests/offline-entry-smoke.test.mjs` | 保留 | 保留真实成员离线重启/失权本机文件可达；删除失权场景搜索排序及离线返回链中掩盖导航失败的额外 goto |
| `browser-tests/outbox-browser.test.mjs` | 保留 | 原生 IndexedDB 中去重、身份隔离与有界扫描；曾有 WebKit 特定索引风险 |
| `browser-tests/pdf-codecs-smoke.test.mjs` | 删除部分 | B6：删除恢复后每个全局 function 枚举，保留 page/Worker 缺失 API 注入证据和真实在线离线像素。 |
| `browser-tests/storage-smoke.test.mjs` | 保留 | 真实 R2 字节经产品下载写入 IndexedDB，停止后端并重启浏览器后谱面仍可见 |

### scripts

| 文件 | 处置 | 独立风险或剩余保障 |
| --- | --- | --- |
| `scripts/backfill-score-file-names.test.js` | 保留 | 历史重名稳定消歧、规范化与重复迁移不改名 |
| `scripts/ci-scope.test.mjs` | 保留 | 未知/删除/改名/跨提交范围 fail-closed，真实 workflow 门禁拒绝异常跳过 |
| `scripts/diagnostic-reports.test.js` | 保留 | 查询安全、环境明确、保留期和真实迁移 schema |
| `scripts/loading-performance-budget.test.js` | 保留 | 故意超出应用粗粒度预算会失败；不是测 JS 比较运算本身 |
| `scripts/loading-performance-report.test.js` | 保留 | 删除三个路径到标签的词汇快照；保留完整样本和中位数报告，避免挑最好结果 |
| `scripts/preview-reader-layers.test.mjs` | 保留 | 预览 fixture 接受笔记后，新阅读器确实读到相同内容；手动工具的接线保障。 |
| `scripts/process-lifecycle.test.js` | 保留 | 释放自有进程及已退出父进程的后代，避免环境污染/端口占用 |
| `scripts/provision-choir.test.js` | 保留 | 生产准入配置合法、邀请码加密绑定和默认不输出凭据 |
| `scripts/release-admission.test.js` | 保留 | 串行部署不倒退、旧/分叉版本拒绝及文档提交不吞掉待发布产品 |
| `scripts/release-artifact.test.js` | 保留 | 只能发布原验证字节与对应 SHA，篡改/错版拒绝 |
| `scripts/retire-image-consumer.test.js` | 保留 | 发布前识别并移除正确旧 consumer，失败不继续；保护部署顺序与凭据。 |
| `scripts/verify-deployment.test.js` | 保留 | 同旧版本不能冒充成功，每个脚本/解码器的身份与缓存验证 |
| `scripts/verify-lifecycle-migration.test.js` | 保留 | 外键、同步高水位及用户删除后历史保留，防止破坏迁移 |
| `scripts/verify-precache.test.js` | 保留 | 离线 Worker/解码器不得漏打包，设计源不得进入发布物 |
| `scripts/vite-server.test.js` | 保留 | 自有临时目录、端口、准备取消和失败退出清理 |

### android

| 文件 | 处置 | 独立风险或剩余保障 |
| --- | --- | --- |
| `android/publish.test.mjs` | 保留 | APK 发布版本不倒退、签名与身份验证分支，不泄漏外部响应。 |

## 非 test 入口与辅助设施

| 入口 | 处置与理由 |
| --- | --- |
| `scripts/run-browser-tests.mjs` | 更新共享层场景名；目录自动发现同步删除项，保留未知/空集合 fail-closed。 |
| `scripts/verify-deployment.mjs` | A10：删除 HTML title、manifest name/short_name；保留预期 SHA、实际脚本字节、缓存/资源/身份与 manifest display。 |
| `worker/test/measure-d1.ts` | 唯一消费者为手工加权“优化证明”，一起删除，不留孤立测量设施。 |
| `verify-auth-migration` / `verify-score-schema-migration` / `verify-lifecycle-migration` | 保留原字段/历史高水位、外键、迁移原子性、旧写入兼容；这些是应用 schema 责任。 |
| `verify-auth-schema` / `verify-precache` | 保留部署前 schema 与发布物 decoder/Worker/offline 清单验证。 |
| `verify-pwa-update` / `measure-loading-performance` | 保留真实两构建 SW 交接、编辑不中断和实际旅程粗粒度预算；没有恢复假定冷/热排序或单次速度常量。 |
| `measure-production-loading` / `verify-product-info-preview` | 按需诊断/预览，不是每次 CI 门禁；不扩展为新的定时测试。 |
| `android/verify` / `verify-domain` / publish | 保留真实 APK 身份、权限、签名、App Links 和读回校验。 |
| CI scope、release admission/artifact、process/vite helpers | 保留自有选择、发布排序/原字节、进程资源隔离；未改重试、并发或超时门禁。 |

## 验证

- Node 24、锁文件安装。已通过 Node 单测 117 项、Worker 123 项（8 unit + 115 integration）、CI scope 20 项、typecheck 和 build/precache；lint 删除遗留 OTP helper 后最终轮通过（初轮 CI 由此失败）；本地迁移验证通过。
- 浏览器全量首轮 156/157 通过。剩余 WebKit pinch 在原始基线同样失败：纸面锚点约 0.009px、文字中心约 0.15px 差异，字形边界宽度约 10px 差异。改查应用坐标与字号比例后，相关 3 文件 18 项全部通过；位置容差不变；变换预览与提交字号后的文字边界并不完全相同，不将具体字体引擎机制冒称已证实根因。
- 客户端首轮 760/761 通过；replacement 场景未等首次 cloud refresh 完成，补充等待后再改变版本，避免新刷新被已有请求合并。修正后的关键 4 文件 19 项通过；完整 Linux CI 结果在 PR 汇总。
- 本地 smoke 在进程回收遇到 `kill EPERM` 后中止，不能报全绿；重新并行运行客户端结果 750/761，遇到 11 个等待超时（首轮通过的未修改用例），未放宽 timeout/retry。这 5 个文件单 worker 复测 124 项全部通过。完整集成结果以 PR 的独立 Linux CI 为准。
- 三项代表性错误注入在独立临时 checkout 执行，注入后均在目标断言变红，随后还原：文档解析完成就结束 loading；允许完成/销毁后 PDF 进度继续发布；XHR 传输完成即返回成功、尚未收到 HTTP 响应。最后一项暴露旧测试只等一个 microtask 的缺口，改为让 Promise 链在下一事件循环前完成后检查请求仍 pending。
- 静态扫描覆盖基线 180 个测试文件。删除了四组 12MB 限速上传（每轮合计 48MB 额外请求体）、半流 HTTP fixture、手工 D1 权重 helper、重复 Worker 安装 UI 启动和导出矩阵。浏览器全量目前 157 项，相比触发 CI 的 169 项少 12 项；不将跨轮耗时差异宣称为加速比例。
- Standards / Spec 双轴审查完成：恒真宽度分支已展开，文件库默认导出选择缺口已补入原有分享场景，无新增浏览器启动。

无生产迁移、发布或真机验收。
