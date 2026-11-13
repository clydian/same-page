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
- 本次未执行真实浏览器端到端测试，也未取得用户故障设备的运行时证据。
