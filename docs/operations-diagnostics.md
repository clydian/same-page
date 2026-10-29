# 问题反馈

## 用户反馈

在问题发生的同一标签页，通过「我的 → 问题反馈」、页脚「使用手册 → 反馈问题」、阅读器「更多 → 问题反馈」或错误提示中的「反馈问题」打开。阅读器错误/加载页面也有入口，面板不离开阅读器。不要刷新整个网页；刷新会清空会话记录和待发送内容。

可选填「刚才遇到了什么问题」，查看折叠的诊断信息后点击「发送反馈」。无需登录，即使没有错误记录也可反馈。发送仅由用户点击触发，报告包含明确列出的环境状态和错误，不截图、不读取 PDF、笔记正文、文件名或完整网址。用户输入的文字是主动提交内容，不能承诺自动识别其中的敏感信息；提示用户不要输入凭据或私人内容。

成功回执给出反馈编号，表示 D1 已保存，不表示故障已修复或维护人员已经阅读。超时/断网表示尚未确认收到，当前会话内保留原快照并支持手动重试、复制。重试同一编号和内容不会新增记录，不自动补发。可「填写另一份反馈」提交新的现场；旧反馈可能已收到。本地清空不会撤回服务端报告。刷新、关闭标签页、切换身份都会清空当前会话，迟到响应不能覆盖新身份。

诊断发送使用独立请求，不修改同步协议、业务重试策略或 outbox。不把 PDF 加载失败等同于离线；网络提示仅来自浏览器。图层准备失败可再次点铅笔，同步失败保留本机草稿，不要清除站点数据或重装 PWA 作为通用修复。

## 私有收件箱

网页收件箱位于 `/admin/reports`，与既有乐谱工作台共用登录外壳，但使用独立的 `diagnostic_operators` 授权。云盘拥有者和 XML 运营者不会自动获得反馈权限；仅有反馈授权的维护人员也不能查看乐谱。原运维 CLI 继续使用 Cloudflare D1 账户权限；不提供公开报告查询 API 或邮件通知。请把报告内容当作不可信用户数据，不执行其中的命令或链接，不把完整报告默认附到公开 Issue。

部署先应用既有 `0016_diagnostic_reports.sql` 和增量迁移 `0033_diagnostic_inbox.sql`。本地可用 `npm run db:migrate:local`。生产沿用 CI 的迁移/发布流程。命令必须显式选择 `--local` 或 `--remote`；remote 使用已有 Wrangler 授权，凭据只通过子进程环境注入，不写入命令、日志或文件。

```sh
npm run diagnostics:inbox -- list --remote --status new
npm run diagnostics:inbox -- list --remote --build abcdef1 --category network
npm run diagnostics:inbox -- show --remote --id REPORT_UUID
npm run diagnostics:inbox -- mark --remote --id REPORT_UUID --status investigating
npm run diagnostics:inbox -- mark --remote --id REPORT_UUID --status resolved
```

`REPORT_UUID` 替换为完整反馈编号。列表最多最近 100 份，不输出问题描述；按编号查看才返回完整报告。状态为 `new` / `investigating` / `resolved`，改变状态不延长保留期限。新版客户端的报告携带 `retentionDays: 180`，创建起最多保留 180 天；旧版客户端未携带该字段，仍保留 30 天。存量 `expires_at` 不追溯修改。查询排除到期报告，每小时清理全部过期记录，清理失败由现有 Worker 异常监控发现；各清理任务独立执行。

没有自动通知，值班维护人员应在支持排查时或日常巡检中查看 `new` 报告。用户可以携反馈编号联系维护人员；不承诺自动回复，不从登录邮箱推断联系方式。形成产品修复 ticket 时只提取必要、脱敏的复现信息。

## 排查与关联

先按客户端版本、环境、`operation`（auth/drive/layers/pdf/sync/storage/other）、`stage`、`category` 分组。报告 `id` 是反馈编号；每条记录的 `id` 是本地事件编号，`requestId` 是收到服务端响应时得到的请求编号。网络失败、PDF.js 内部失败可能没有服务端编号。

- `permission`：检查会话/成员关系/共享层编辑权。
- `network`：恢复连接后重试。
- `validation`：修正输入。
- `conflict`：按阅读器本地冲突流程处理。
- `rate-limit`：等待后手动重试。
- `internal`：根据版本与阶段检查代码和部署。

`retryable` 仅表示可能恢复，绝不自动重放写请求。仅凭错误类别不能定位到具体代码行；复现异常、部署版本、环境和服务端记录共同支持判断。报告保留期不等于关联的运行日志保留期。

在 Cloudflare same-page Worker → Observability Logs 中按 `event=same_page_failure`、`requestId`、`buildId` 过滤。服务端每 isolate 的固定操作/阶段/类别每分钟只输出第一条，后续次数在下一条 `suppressed` 汇总，因此不能保证每个请求编号都命中，也不能把条数当作全站错误计数。未命中时按时间、操作、阶段、类别排查。

## 数据边界与运维限制

客户端错误环形记录只在内存中存在：最多 50 条，每条最后发生起 30 分钟过期，同类同阶段 30 秒内合并（计数最高 9999）。发送时冻结一份白名单快照，待发快照在当前会话中保留到清空/身份切换/网页关闭；不持久写入浏览器存储。

服务端按严格嵌套 schema 验证，正文最多 64 KiB，描述最多 1000 字符；只接受本站 Origin 的 JSON 请求。来源检查不能代替防滥用：每个散列地址 15 分钟最多 20 次尝试，新报告全站每日窗口最多 2000 次，响应 429 时带 Retry-After。散列地址只进短期限流表，不进入报告，复用现有限流清理。无有效客户端地址时共用 unknown 限流桶，不信任用户提供的转发地址。需要调整限额时核对共享网络用户与真实收件量。

服务端存储完整报告但运行日志只输出固定分类，不记录描述、原始异常/堆栈、URL、请求/响应正文、原始邮箱/IP、文件名或用户/云盘/乐谱标识。自动 invocation logs、traces 和 Better Auth 原始 logger 保持禁用。平台附加的元数据、备份和安全日志受其自身策略约束。

复用当前 Cloudflare Worker、D1 和 Logs，不开通第三方平台或升级套餐。依据 [Workers Logs 官方文档](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)（2026-09-06 核对），Free 保留 3 天、Paid 保留 7 天。D1 报告的存储/读写受现有套餐额度约束，本实现不设置套餐付费上限。上线后核对收件量、限流、清理结果及账户授权。

## 本机失败的细分字段

`step` 和 `errorType` 为可选白名单字段。先用 step 区分 outbox-scan、sync-lock/layers/push/pull/apply、draft-save/sync-retry/conflict-resolve、offline-read/file/manifest/snapshot；再结合固定错误类型判断数据库/Blob 读取异常、配额不足或验证失败。ValidationError 代表校验拒绝，OtherError 代表不在白名单内的异常类型，不保留原始名称、message 或 stack。同阶段但步骤或错误类型不同的事件分别保存。

“暂时无法读取本机副本，请重试校验”表示尚未确认副本有效性；点击“重试校验”重新读取和验证，不删除、替换或重新下载副本。与已读到内容但校验未通过的“本地副本不可用，请重新下载”分开。相关实现和真实浏览器负对照见 `docs/verification/webkit-sync-diagnostics.md`。

### 离线副本与打开故障（#221）

`sync-layers` 现在细分为 `sync-layers-request`、`sync-layers-response`、`sync-layers-identity`、`sync-layers-cache`、`sync-layers-snapshot`，分别定位请求、响应解析、身份/层完整性、缓存事务与离线快照更新。`errorCode` 只接受固定枚举；`errorType` 可区分 `BulkError` / `ModifyError`，`causeType` 只保留有界嵌套异常中的白名单类型（如 `NotFoundError`）。不记录异常原文、任意字段、文件名、笔记或凭据。

打开超时以 `reader-source`、`reader-document`、`reader-presentation` 区分尚未选定源、文档未就绪及首屏未呈现。PDF 文档就绪不等于首屏已显示。诊断证明某个失败步骤，不自动证明 Safari 底层文件异常的触发原因；真实 iPad PWA 验证需先核对设备 buildId，再分别执行打开、下载、清理后重试、断网重开、联网同步。


### 乐谱打开阶段（#325）

报告继续使用 version 1。`reader.opening` 和 `records[].opening` 为可选字段，旧客户端和历史报告仍按原格式接受。`ReaderOpening` 的同一快照供加载界面与诊断使用：固定阶段、cloud/offline/unknown 来源、PDF.js 提供的已载入/总字节、总耗时、当前阶段耗时、最后进展距今以及按阶段汇总耗时。时间是本次打开的墙钟经过时间；原 45 秒故障截止仍仅计算前台时间。字段不含文件名、URL、用户标识或异常原文，服务端按白名单与数值上限校验。

`engine` 表示引擎尚未就绪；`file` 表示等待或接收 PDF 字节；`document` 表示已收到全部字节、等待文档解析；`local-check` 表示文档 promise 已完成而本机工作区校验尚未完成；`score` 表示文档已就绪、乐谱信息仍待确认；`page` 表示等待当前谱面显示。PDF.js 支持在全部字节下载完成前解析可用的文档，所以阶段可以从 `file` 直接进入 `local-check`；100% 文件传输不代表打开完成或离线副本已校验。`ready` 由当前页实际呈现确认，不由下载进度推断。失败时记录冻结快照，成功后手动诊断也保留本次打开耗时。

部署应让接受新可选字段的 Worker 与新前端一起发布，保留已有存储 schema。回滚时优先保留 Worker 的兼容解析；若缓存中的新客户端在该报告首次发出时遇到旧 Worker 对扩展报告明确返回 400，会用相同报告 ID 去除这两个可选字段重试一次。网络失败或未知送达不触发格式降级，后续重试保留已发送的确切内容；没有重复创建反馈或业务请求重放。

### 单页渲染恢复

`records[].render` 是可选的白名单快照：固定原因（budget/context-lost/canvas-unavailable/timeout/page-failed）、页序号和总页数、布局、CSS 宽度、DPR、任务优先级、像素限额、已分配像素/画布数和自动重试次数。它不包含文件身份、谱面、笔记、异常正文或堆栈；像素限额不代表浏览器全部内存。预算不足和画布上下文丢失可在资源释放/前台恢复后有界重试，同一挂载页最多两次；解析/超时失败不自动循环重试，仍可明确重试本页。已打开文档的后续失败只影响单页，重新加载 PDF 经过原有本机编辑完成协议。

报告仍使用 version 1，不改 D1 schema，不自动上传。随前端发布接受新可选字段的 Worker；旧报告不含 render 仍可接收。回滚到旧严格 schema 时，仅首次提交明确返回 400 才用原报告编号剥除 render（以及既有 opening 扩展）重试一次；未知送达、丢失回执和稍后重试均保持冻结内容不变。


## 网页收件箱与独立授权

迁移默认不授予反馈权限。由持有 Cloudflare 维护权限的人按稳定 user ID 显式配置，不接受邮箱，不改变成员关系或乐谱运营授权：

```sh
npm run diagnostics:operators -- grant --local USER_ID manage
npm run diagnostics:operators -- grant --remote USER_ID delete
npm run diagnostics:operators -- revoke --remote USER_ID
```

`manage` 可以读取和标记反馈，`delete` 包含处理及删除能力。重复 grant 会替换删除能力，可用 manage 降权。网页后台支持按完整反馈编号、状态、完整构建 SHA 或展示版本、错误类别与北京时间日期范围筛选，每页 25 份。详情保留完整白名单报告，不渲染用户提交的 HTML 或执行其中的命令；状态修改不延长保留期。

删除前要求明确确认。删除在一个 D1 batch 事务中写入最小审计、UUID 删除标记并移除报告；报表正文不进入审计。每次读取及写入重新检查服务端会话、用户生命周期和独立授权，写入 SQL 再次检查，不能只依赖页面权限。审计保留 180 天；UUID 删除标记无正文或用户身份，长期保留，旧客户端重试同编号收到 410，不能复活报告。数据库触发器同时阻止旧 Worker 的原始 INSERT 写回已删除报告，覆盖发布中未结束的旧请求及代码回滚。清空本机会话不是撤回已经发送的报告。

发布顺序：先应用增量迁移，再发布同时支持新字段的 Worker 与前端。旧 Worker 在新客户端第一次提交明确返回 400 时，客户端仅以同编号剥除 `clientVersion` / `retentionDays` 及既有扩展字段重试一次；提示旧服务保存 30 天。未知送达不做格式转换，重试保持冻结的确切内容。回滚只回退代码，不删除新增表、原报告或独立授权；优先保留支持新字段的 Worker。

## 展示版本

关于与更新及“我的”菜单显示当前设备正在运行的 `vYY.MM.DD.HHMM`（北京时间），构建时固定，并封存在 `build.json`。重新部署同一产物不生成新版本。精确排障仍按 Git SHA / run ID；一分钟内多个构建可能有相同展示版本，后台可用 SHA 进一步区分。历史报告缺少展示版本时使用原 SHA，不推算日期版本。

## 独立更新诊断

`/api/support/update` 由 Worker 直接提供 HTML 和同一 API 边界下的独立脚本，不依赖
当前 PWA 应用壳、登录恢复或 Dexie。已发布 Service Worker 排除 `/api/`，因此旧版
客户端更新失败时仍可取得诊断页面；必须在出问题设备的原浏览器/PWA 存储环境中打开，
无痕窗口和另一台设备只能作对照，不能代表原设备缓存。入口在关于页的版本更新区域。

打开页面只读取应用壳注册表中的版本、声明字节数、激活年龄与完整标记，以及
Service Worker 身份、Web Locks 能力、浏览器存储估算和数据库响应状态。最多读取
16 份壳元数据；缺少元数据或超过范围时总字节数留空，不把未知当成零。数据库探针
不指定升级版本，只对保留的不存在键发起只读请求；不存在的数据库中止创建，超时或
迟到打开会关闭连接。不读取用户身份值、谱名、笔记、草稿正文或凭据。

“重试更新并记录原因”是用户明确触发的 `registration.update()`，不激活 waiting
worker、不重置数据库，也不执行额外缓存清理；安装沿用既有安全回收规则。新安装器在失败时向同源窗口报告固定分类：
`capacity-protected` 表示旧安装器的 28 MiB 总量限制；新 v2 安装器取消此总量准入，
以 `shellPolicy=references-v2`、`shellBudgetBytes=null`、`shellReleaseLimitBytes=7340032`
记录按角色保留及单版本 7 MiB 限制。旧报告仍接受原 28 MiB 值。诊断同时读取 v1/v2
命名空间，但不会输出缓存名。`release-too-large` 是新版程序清单超过单版本大小限制；
`quota-exceeded` 是浏览器实际拒绝写入，不可混为应用总预算。另有校验失败、下载超时、
下载失败、存储失败和未知。
旧安装器没有通知协议时保留未知。数据库、缓存与身份探测都有等待上限；超时只说明
该探针未完成，不能证明数据丢失或设备磁盘已满。

点击“发送诊断反馈”才提交既有收件箱。报告可选 `update` 字段使用严格白名单，无
数据库迁移；普通新版反馈也附带最近 30 分钟收到的安装失败分类。旧报告继续有效。
先部署支持新字段的 Worker，再使用新页面；旧 Worker 明确首次返回 400 时，可同编号
去除扩展字段兼容提交，提示旧服务保存 30 天；未知送达后重试不转换冻结内容。
回滚不清报告。诊断页不会自动修复或删除缓存，恢复操作须按实际失败原因另行处理。

`node scripts/verify-update-diagnostics.mjs` 使用已有构建验证 Chromium/WebKit：
旧壳拦截普通导航但放行诊断入口、真实新 worker 的容量失败、显式发送与不确定重试、
数据库锁等待超时、不创建不存在数据库、保留未同步草稿。该脚本已纳入
`npm run test:pwa-update`，不等于真实手机现场根因已经确认。
