# 连接线路与应用离线提示不一致

2026-11-13，在 `04e6b270439f4f461832a22f4651147c41920c9e` 上调查。
用户确认看到线路持续“可连接”，同时应用另有离线／本机提示；头像菜单未出现通常会出现的产品后台入口，更新通道操作也提示离线。具体离线提示文案未取得，不能把早先语音转写的“版本”解释成明确状态。

## 线上只读核对

2026-11-13 23:26–23:29 UTC，通过生产公开 GET 核对：

| 项目 | 当前值 |
| --- | --- |
| `/api/client-release` 默认 stable | `aa604ba541364591eab4b171aff85f96a9f7742f` |
| 带合成 beta 偏好 Cookie 的同一 GET | `04e6b270439f4f461832a22f4651147c41920c9e` |
| revision / backend | `44` / `04e6b270439f4f461832a22f4651147c41920c9e` |
| stable 的 sealed build.json 版本 | `v26.10.29.0903` |
| beta 的 sealed build.json 版本 | `v26.11.13.2213` |

合成 Cookie 仅加在本次只读请求头中，没有调用通道选择 POST，没有改变用户浏览器的偏好。这些观测不证明用户设备运行的是哪份壳、会话或本机状态。

## 代码证据

| 信号 | 来源与边界 |
| --- | --- |
| 两条线路的“可连接” | `ConnectionController.sample()` 每次只请求 `/api/health`，验证 JSON `status: ok`。`worker/index.ts` 的 health 返回常量与 buildId，不检查登录、D1 或用户本机 IndexedDB。采样不修改身份、业务失败冷却或选路。 |
| 当前线路与异常图标 | `routeAvailability()` 合并业务观测与健康采样，以较新者展示；同毫秒分歧取失败，45 秒过期。新健康成功可以覆盖旧业务失败的**展示**，不能恢复业务能力。原有测试明确覆盖这一语义。 |
| 线路身份 `ready` | `check()` 另外请求 `/api/connection/status`，只核对该入口的 sessionId 是否等于预期。预期与实际均为空时也能 ready；它不代表已登录，也不检查本机工作空间归属。 |
| 应用登录状态 | `useApplicationIdentity()` 使用 `authClient.useSession()`，区分 checking / authenticated / signed-out / unreachable / local-unavailable。本机记住的归属不授予在线权限。 |
| 登录返回后的本机检查 | `acceptSession()` 在返回 session 前等待 `acceptNewSession()` 的 IndexedDB 退出围栏事务。健康成功不覆盖该检查；本机读写等待可独立阻塞身份确认。`createSessionFetch()` 的 10 秒 signal 传给 transport，不能据此断言之后等待的本机事务也有 10 秒期限。尚未在真实故障设备上确认有这种等待。 |
| 头像产品后台入口 | `PersonalMenu` 要求菜单打开、确认的用户及 session、`useNetworkStatus()` 为真，然后请求 `/api/admin/session` 并确认后台权限。浏览器报告 `navigator.onLine=false` 时不请求且不显示入口。身份尚未确认、请求失败或无权限也都不显示；入口缺失不能单独证明权限丢失。 |
| 更新通道 | `selectReleaseChannel()` 在 `navigator.onLine=false` 时直接返回离线文案，尚未发出 POST。`refreshReleaseChannel()` 独立使用同源原生 fetch（不走连接线路 controller），还要读取/写入 CacheStorage receipt；任一步失败时，根据当时的 navigator.onLine 选择离线或通用失败文案。因此这句提示本身不能证明实际 API 断网。 |
| 阅读器“PDF 已就绪，正在校验本机状态” | `ReaderSession.openSource()` 获得 PDF 后进入 `local-check`，等待 `current()` 内的 `assertLocalWorkspaceActive()`。这与公开 health 独立。`useReaderSync()`、`ReaderSession.refresh()` 另受 navigator.onLine 控制。 |

没有发现应用级全局“强制离线”开关。用户所说离线模式可能是本机副本打开方式、浏览器网络模拟或系统报告，但未验证具体操作，不作归因。

另有一个明确展示缺口：云盘列表与云盘入口将 `connectionControl` 传给 `IdentityNotice` 后，启用双线路就直接隐藏 checking 和 unreachable 提示。线路健康成功时，用户因此可能只看见正常的连接入口，看不到独立的身份失败提示。

## 隔离复现与最小修改

新增一条挂载组件回归：合成 `navigator.onLine=false`、health 成功、入口身份请求失败，以及保留本机用户的应用身份 unreachable。未修改前在“身份失败提示应可见”的断言失败；修改后确认线路结果仍显示可达、当前线路待确认、浏览器离线报告及身份失败提示均可见，controller 的身份仍是 unprepared。

本次只修改展示：

- 将健康成功称为“线路可达”，面板始终说明检测只确认服务响应，登录、本机内容、更新各有自己的状态。
- 浏览器报告离线时显示明确提示，不让 health 成功覆盖它。
- 去掉 IdentityNotice 的连接入口抑制条件，让原有 checking / unreachable 提示及重试入口继续显示。

不改变采样、选路、浏览器联网门禁、身份校验、更新通道协议或任何持久格式。没有增加健康成功自动授予权限、自动重试写入或本机数据清理。

## 与乐谱打开故障的关系及边界

**已复现**：健康成功、浏览器离线信号、身份请求失败可以在合成条件下同时存在；此前连接入口会掩盖列表中的身份提示。展示缺口是真实代码问题。

**代码支持但仅为假设**：若用户设备的本机数据库等待，同时影响 session 接受事务和阅读器 workspace 校验，就可解释健康正常、后台入口缺失与 local-check 等待。若 navigator.onLine 为 false，也可直接解释后台入口缺失、通道切换被拒及同步暂停。这些是可以并存的路径，不能由症状选出唯一根因。

**未验证**：用户故障时的 navigator.onLine、get-session 完成情况、`/api/admin/session` 是否发出及返回值、具体更新提示来自 refresh 还是 select、IndexedDB 事务是否停滞、实际运行壳版本。没有复现用户真实设备的目录空白或证明任何数据丢失；本次提示修复不宣称解决乐谱加载故障。

与另一个本机工作区调查交叉时，应对齐同一次故障的上述信号及 reader opening phase。先保留现有数据、会话和缓存，不以健康成功代替本机诊断，不以目录空白推断数据已删除。

## 本地验证

- 修复前新回归失败（独立身份失败提示被隐藏），原有两条面板测试通过。
- 修复后连接 controller / sampling / presentation / 面板、头像菜单和离线入口共 103 条通过。
- 应用路由、列表连接和阅读器 workspace 共 62 条通过；版本许可与通道 readback 共 9 条通过。
- `npm run lint`、`npm run typecheck`、`npm run build`、`git diff --check` 通过。
- 本地未执行真实浏览器端到端测试；之后的远程 CI 结果见下方补充。尚未取得用户故障设备的运行时证据。

## 补充：联网打开后再次离线可用

用户随后实测：先前可能处于离线，但尚不确定关联；重新联网后能打开乐谱，再切离线也能打开。此观察说明后一次操作条件已改变，不能据此认定首次离线必然失败，也不能证明已经修复了持久故障。尚不清楚两次是否在同一页面、是否关闭进程、是否同一份副本完成了准备。

代码中可明确区分以下变化：

| 联网打开可能改变的状态 | 生命周期及其对再次离线的意义 |
| --- | --- |
| session 与已显示的 localUserId | `useApplicationIdentity()` 可从已确认 session 得到用户；之后 session 暂时失败、而本机归属读取仍未完成时，保留该页面已经显示过的 localUserId。冷页面没有这个历史值。仅保留本机归属，不保留在线操作权限。 |
| active / last authenticated owner 与 epoch | `LocalIdentityObserver` 在确认用户后激活并持久化归属；`resolveLocalWorkspace()` 对已知 localUserId 也可激活归属，**不要求先联网**。本机健康且归属可读时，离线打开已有 workspace 是受支持路径。 |
| 离线 PDF、当前修订及笔记快照 | `ReaderSession.prepareAutomaticOfflineCopy()` 在云端已确认、PDF 就绪、没有匹配本机副本等条件下才准备副本。成功后保存经过完整校验的 PDF 与独立笔记快照；联网可能补齐原本未就绪的副本，不能只称为内存预热。已有匹配副本则不会因此再准备一份。 |
| 目录和乐谱元数据 | 联网成功可刷新持久目录及 ReaderScoreCache 内存摘要；目录可见并不意味着 PDF 与笔记快照已经完整。 |
| PDF 引擎与 document | 动态导入模块可留在页面内存；document 缓存按归属、云盘、乐谱及 cloud/offline 来源隔离，最多保留两项，无引用后 15 秒释放。不能笼统声称“在线 PDF 缓存直接绕过离线读取”。若只是留在同一阅读器后断网，已显示谱面本身也不能验证冷启动。 |
| 本机校验 | `inspectOfflineScore()` / `verifyOfflineScore()` 只合并在途校验，不长期缓存“校验成功”。后续独立打开仍校验当前 Blob 字节、快照与归属，持久内容变化会使共享检查失效。联网不会把 health 成功记作本机校验通过。 |

增加了一条跨 identity + workspace 的隔离测试：只让身份恢复用的归属查询保持 pending（实际 workspace 数据库健康），无 session 的冷页面等待；提供在线确认的同一用户后 workspace 就绪；再撤掉在线身份、归属查询仍 pending 时，保留本机用户与同一个 ready workspace，同时在线用户权限变为 null。测试通过。这证明“冷页面等待、同页联网后再次离线可用”在特定合成条件下确实可出现，**没有证明用户设备当时发生了归属查询停滞或整个 IndexedDB 堵塞**。

本轮 identity / workspace / 离线入口 / 自动准备相关 47 条测试通过。已有 PR 首轮 CI（commit `96d173e`）已全部成功，包含实际浏览器 fixture：

- Chromium 的 `offline-browser-restart`：先在隔离 profile 完成副本准备，关闭并重启浏览器，再断网新建页面，恢复目录、打开谱面并编辑，之后联网保持阅读与编辑状态。通过。
- WebKit 的 `api-outage-new-page`：准备副本后，禁用测试 SW 并对新页面注入 API 失败，测试冷 JS 状态。通过。它**不是**完整离线壳／iOS PWA 进程重启证明。

CI 证据：[run 43527717714](https://github.com/clydian/same-page/actions/runs/43527717714)，`smoke (1)` 中上述两个子测试均为 ok。它们验证健康合成持久数据下的受支持路径，不排除真实设备的存储等待、资源未准备完成、版本切换或身份恢复竞态。

下一步最有区分度的证据是：同一故障阶段的 navigator.onLine、实际 opening phase、session 是否仍 pending、workspace 是否已就绪，以及“再次离线成功”是当前页重开还是彻底关闭后的冷开。应沿用另一条工作空间调查收集这些信号，避免为验证猜测而清缓存或改变用户归属。本次没有据此更改离线初始化或绕过任何归属与完整性校验。

## 补充：矛盾的机制、实际断网时序与处理边界（2026-11-14）

**已确定的代码根因是状态来源、作用范围和刷新时机不同，却给出了容易被当成全局在线证明的展示。** 它不等于已经确定用户设备的故障原因。

旧线路行仅展示上一条 health 采样；当前线路文字／浮动入口合并业务请求与 health 的较新证据。打开面板才有采样周期：最初每轮完成后等 10 秒，连续三轮同结果后等 30 秒，每轮另有最多 3 秒期限；45 秒后旧结果过期。`offline` 事件不会立即产生一条失败采样，也不触发 `ConnectionButton` 的 `check()`（原来只监听 online 与 visibilitychange）。因此浏览器即时离线门禁与上一条成功采样能够同时存在。

还有一个入口展示缺口：面板关闭时既不持续采样，也不推进 `now` 展示时钟；旧浮动按钮不以浏览器离线信号驱动异常展示，空闲时的 Wifi 图标不能证明状态刚检测过。PR 初版只在展开面板解释差异仍不充分。本轮补齐：浏览器报告离线时，即使面板关闭，也保持入口可见并显示“浏览器离线”及 WifiOff 图标。它不修改样本、session、选路或联网门禁。

### 已验证的组合

| 输入与触发条件 | 可观察结果 | 证据与边界 |
| --- | --- | --- |
| health 成功后发生真实浏览器离线事件，下一轮尚未完成 | navigator false，旧健康行仍成功；联网操作已暂停 | Chromium 真实 `context.setOffline(true)`，不改写 navigator、不代答 health。新增浏览器回归通过；推进下一轮后两条健康行均失败。 |
| 旧 health 成功，之后业务请求失败 | 当前线路可显示“暂时连不上”，线路行仍保留成功 | 原有时间顺序挂载测试补断言。线路行与顶部读取不同证据，不能把两者合成同一次检查。 |
| browser false，即使本机仍有确认的用户与 session | 头像菜单不发后台权限请求，不显示后台入口；通道选择不发 POST | 新增菜单和版本许可回归通过。它们证明前置门禁，不证明服务端拒绝或用户权限变化。 |
| health 新响应成功，status 失败，session 不可用 | 线路可达但身份 unprepared，用户仍不能使用需要在线身份的功能 | 合成 transport 回归通过；它不检查本机数据库。 |
| health 新响应成功且 navigator false | 两个不同信号可在注入条件下并存 | 此前 unit test 人为设置 navigator getter；**未证明真实浏览器在持续离线时仍有新的 health 网络成功响应**。不能据此认定用户设备的系统信号有误。 |
| browser true，但请求超时、401/403、502/503或本机接纳等待 | 对应业务仍不可用，health 可能正常或只有旧成功 | 代码路径不同；HTTP 拒绝不是本机数据丢失证据。navigator true 也不保证某个 API 可用。 |
| 同页在线确认过用户，而本机归属恢复查询还在 pending，之后再失去在线身份 | 可保留本机归属和 ready workspace，但不保留在线权限 | 上节隔离测试通过；不代表真实设备的 IndexedDB 整体堵塞。 |

真实浏览器时序在第一轮成功后断网，因此下一次失败样本在 10 秒调度后出现。稳定周期下，则需等最多约 30 秒的间隔再加本轮最多 3 秒；这些界限假设页面可见、浏览器任务正常执行且没有额外身份/可见性触发。超过该窗口仍持续显示**新鲜成功采样**，不能再只用这段时间差解释。关闭/隐藏面板的暂停与冻结时钟也要分别判断，不能把它们称为持续新检测。

HTML Standard 对 [navigator.onLine](https://html.spec.whatwg.org/multipage/system-state.html#navigator.online) 的定义也区分浏览器判断与实际服务可达性：true 仅表示可能联网，不保证有互联网或指定 API 可用。本次没有把这个事实反向用作“浏览器 false 必然误报”的证据。Service Worker 的 fetch handler 排除 API 请求，不能把这里的历史成功样本说成健康 API 从 SW 缓存返回的成功响应。

### #652 能修复和不能修复什么

本次实质修复两个展示缺陷：不再因连接入口存在而隐藏身份提示；浮动入口在浏览器离线时也明确报告该信号。与此同时，将 health 成功称为“线路可达”，面板注明下方为上次检测记录。保留不同来源的事实，避免用健康接口给登录、后台权限、本机内容或发布通道作担保。

**它是提示与可发现性修复，不是联网功能或本机等待的根治。** 以下应分别处理：

- 若实机证明 browser false 时该业务 API 仍实际可用，应针对相应用户主动操作评估有界实际请求确认，而不是用 health 覆盖 browser 信号、授予权限或自动重放写入。#652 保留现有硬门禁，没有解决这类潜在误阻断。
- 更新许可仍走原 origin 的 `/api/client-release`，不走业务双线路；可用备用业务线路不能证明更新可用。这是已有 [#614](https://github.com/clydian/same-page/issues/614) 的设计范围，需保留原域名 HttpOnly 通道 Cookie 与读回权威，不宜在提示 PR 中顺手改成跨域选择。
- 网络响应后等待本机 session 接纳、workspace 校验及快照恢复的阶段，需要另一条本机工作空间调查继续定位。`createSessionFetch` 的网络 signal 不能结束后段本机事务；若需要期限，应同时验证迟到事务、归属切换和重试，不能仅 Promise.race 后就允许旧事务回写。
- 更新信息读取还包含 CacheStorage receipt 操作，失败时仅按当时 navigator 选择文案，不具备阶段诊断。这也是为什么“当前离线”不能单独定位到网络。

尚缺的实机证据包括：具体离线操作及原始文案、health 最后一条采样时间与后续结果、面板是否保持可见、navigator 值与事件、session 接受所处阶段、工作空间状态，以及再次离线是否完整重启。没有这些证据，就应将“状态矛盾的已知机制”与“此次设备故障的根因”分开报告。

新增本地实测：Chromium 156、真实本地 Worker 与两条 HTTPS 合成入口，`connection-sampling.test.mjs` 通过；本机只对测试用 nip.io 主机强制解析到 127.0.0.1 并绕过环境代理，生产访问不受影响。回归新增后台前置门禁和通道选择不发请求验证；未触及真实用户数据。

## 截图对照（2026-11-14）

用户希望用界面理解差异后，使用旧源码 `04e6b27` 与 PR 源码 `87391ac` 分别启动真实本地页面，完成同一套“联网确认后台权限 → health 成功 → 浏览器断网 → 看菜单／面板 → 点击通道”操作。[截图及条件](connection-status-mismatch/README.md)包含七张原始 PNG 与两份来源记录。它们不是用户故障实录；面板取景在上次成功约一秒后暂停测试时钟，不证明持续成功或系统误报。源码模式的版本时间也不能用来核对已部署版本。

截图进一步确认：旧列表原本就会通过 `useNetworkStatus()` 显示“当前离线，已保存的乐谱可以继续打开”，同时旧连接按钮仍显示普通 Wifi；IdentityNotice 被抑制的是独立的身份 checking / unreachable 信息，不能混同为全部离线文字被隐藏。

实际取景还发现离线文字和连接入口共用左下位置。本 PR 以可见连接入口为条件，将该文字放到入口上方；capture 对实际 bounding boxes 断言无重叠。两份源码的后台与通道前置门禁均由运行中的页面验证：断网后菜单不发后台权限请求，点击通道不发选择 POST。这些功能门禁没有被截图或本 PR 取消。
