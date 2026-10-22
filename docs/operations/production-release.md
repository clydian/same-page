# Production release runbook

本页把“代码通过”“已发布”“域名可达”“邮件可投递”和“实机验收”分开记录。任一项
通过都不能替代其余项目。

## 过期限流记录清理

沿用 `0 * * * *` 的每小时调度，每次最多删除 500 条 `window_expires_at <= 当前时间` 的限流记录，按到期时间从旧到新处理。未过期计数不变；到期时刻与原限流窗口重置条件一致。单条原子 SQL 同时选择和删除，并在删除条件中再次检查到期时间，没有分开扫描后误删已续期窗口的间隙。

`0012_rate_limit_expiry_index.sql` 只新增 `(window_expires_at, key)` 覆盖索引，不修改已有窗口或身份；迁移首次构建索引会读取现有记录并占用额外索引空间，之后每次窗口写入也维护索引。清理按索引取最多 500 个候选并按主键删除，不做全表计数、无界循环或跨批长事务。按默认调度，持续积压时最多每小时处理 500 条（每日 12,000 条），不是无限吞吐保证。

成功日志只有固定事件 `same_page_rate_limit_cleanup` 与 `removed` 数量（包括 0）；连续多次达到 500 说明可能存在积压，可再用受控只读聚合查询确认，不输出 key 或身份。失败沿用 `same_page_failure`，固定 `operation=auth`、`stage=cleanup`，不记录数据库原始错误。乐谱与限流清理分别注册 `waitUntil`，任一失败不阻止另一项执行，失败会继续向运行时抛出脱敏错误；下一次每小时调度可安全重试，不承诺平台自动补跑。

## 固定生产边界

- URL：`https://samepage.clyapps.com`
- Worker：`same-page`，关闭 `workers.dev` 与 preview URL
- D1：`same-page-production`（APAC）
- R2：`same-page-production-scores`（APAC、Standard）
- 邮件发件人：`Same Page <login@samepage.clyapps.com>`
- Resend 发信域：`samepage.clyapps.com`，与根域真人邮件/Webmail 信誉隔离
- Resend key：Same Page 独立、Sending access、只允许 `samepage.clyapps.com`
- CI Cloudflare token：Same Page 独立，包含 Workers Scripts Write、D1 Write、
  Workers R2 Storage Write、Account Settings Read、Workers Queues Write，以及
  `clyapps.com` 的 Workers Routes Write。PDF 阅读在浏览器中完成。

生产 Secret 只存在于 Resend、Cloudflare Worker 和 GitHub Actions 的 secret store。
不得写入仓库、Issue、PR、日志、终端历史或发布记录。

## 首次发布

首次发布由运维人员完成以下步骤：

1. 创建生产 D1 与 R2，并核对区域、名称和绑定。
2. 对生产 D1 执行全部 `migrations/`。
3. 在 Worker Secret 中设置彼此独立的 `BETTER_AUTH_SECRET`、`INVITE_SECRET` 与
   `RESEND_API_KEY_SAMEPAGE`。需要启用第三方登录时，再设置完整的 `GOOGLE_CLIENT_ID` /
   `GOOGLE_CLIENT_SECRET`；缺少任意一项时
   对应入口会保持隐藏。
4. 部署前先在 Resend 验证 `samepage.clyapps.com` 的 SPF、DKIM、DMARC 与 Return-Path，
   创建仅允许该子域的 Sending-only key，并先写入尚未被当前版本读取的 Worker
   `RESEND_API_KEY_SAMEPAGE`。代码部署时才切换到该 Secret，避免旧发件人与新密钥不匹配；
   旧 Secret 和旧 key 仅保留到真实投递验收完成，以便回滚。发信子域记录不得改动根域 MX、
   Cloudflare Email Routing 或 Webmail；不得在域未 verified 时切换 From。
5. 部署 Worker 与静态资源；Wrangler 的 custom domain 配置负责创建 DNS 记录和证书。
6. 在 GitHub `production` environment 中设置 `CLOUDFLARE_API_TOKEN` 与
   `CLOUDFLARE_ACCOUNT_ID`。
7. 运行 `npm run verify:deployment -- https://samepage.clyapps.com <expected-source-SHA>`。
8. 首位管理员完成 OTP 注册后，按 [云盘初始化命令](../runbooks/local-development.md#创建首个云盘) 使用 `--remote` 创建“小红花云盘”。自动化命令不显示
   初始邀请码；管理员登录后在「管理 → 邀请码」查看，并通过私密渠道交付。
9. 如需启用“公开体验”，使用 `--guest-admission open --preview-entry` 创建唯一的公开体验云盘；已有开放准入云盘必须通过受控 SQL 明确设置 `is_preview_entry = 1`，不得按名称自动匹配。

## 认证邮件发送边界

- 标准化邮箱共享 60 秒冷却与 3 次/15 分钟窗口；客户端身份共享 10 次/15 分钟窗口。
  三者都由 Worker 执行，`429` 必须带 `Retry-After`，刷新或多标签页不能绕过。
- 为避免通过限流差异探测用户是否存在，可投递地址与不可投递地址都消耗相同发送门槛；实际
  成功发送数只会小于或等于门槛。D1 只保存 HMAC 后的邮箱和客户端标识，不保存原值。
- 注册和密码重设共用上述门槛；新 OTP 发出后旧 OTP 失效，有效期 10 分钟，每个 OTP 最多
  尝试 3 次。
- 邮件主题不得包含 OTP；text/HTML 正文必须说明 `samepage.clyapps.com`、用途、10 分钟
  有效期和非本人操作处理方式，不使用远程图片、营销内容或站外链接。
- Resend `Delivered` 只表示收件服务器接受。发布证据必须把 provider 状态、实际 Inbox/Spam
  位置和延迟分开记录，且不得包含 OTP、完整收件地址、Message-ID 或密钥。

## 第三方登录配置

- Google 使用 Web application OAuth client，授权回调固定为
  `https://samepage.clyapps.com/api/auth/callback/google`，只申请 `openid`、`email`、
  `profile`。OAuth 品牌配置中的应用首页为 `https://samepage.clyapps.com/`，隐私政策为
  `https://samepage.clyapps.com/privacy`，Authorized domain 填根域 `clyapps.com`（不带协议、
  子域或路径），并通过 Google Search Console 验证域名所有权。上线前单独确认 consent
  screen、品牌信息、允许域名和测试/发布状态。
- Client ID 与 Client Secret 都以 Worker Secret 管理。不得把 Secret 放入 `wrangler.jsonc`、
  `.dev.vars.example` 的实际值、GitHub Issue、PR 或发布日志。
- 部署代码、平台审核通过、生产 Secret 完整、真实账号授权成功是四个独立门槛。只有最后一项
  通过后，才能把对应提供方记为生产可用。

### 第三方登录故障排查

排查只记录提供方、时间、HTTP 状态和非敏感错误类别；不得复制授权 URL、callback query、
authorization code、token、完整 profile 或 Secret。

| 症状 | 检查 |
| --- | --- |
| Google图标未出现 | 请求 `/api/auth/social-providers`，确认响应仍为 `no-store`；用 `wrangler secret list` 只核对对应 Client ID / Secret 的名称是否成对存在，不读取或打印值。缺一项时隐藏入口是预期行为。 |
| Google 报 redirect URI 不匹配 | 核对 Web application client 的精确回调是 `https://samepage.clyapps.com/api/auth/callback/google`，协议、域名、路径和尾部斜杠必须一致。 |
| Google 只允许测试用户或显示 consent 错误 | 核对 consent screen 的测试/发布状态、测试用户、品牌域名和已验证域名；平台未发布不能记为生产可用。 |
| 提供方确认后回到登录页并提示失败 | 先确认 `/api/health` 和邮箱登录正常，再按时间查 Worker 的非敏感状态日志；不要在日志或 Issue 中粘贴 callback URL。state 失效或重复回调应安全返回登录页，不能绕过重试。 |
| 中国大陆网络下 Google 超时 | 记录网络、设备和时间，将 Google 判为该场景不可用；确认邮箱入口始终可见可用。不要通过放宽 OAuth 校验或增加代理回调规避。 |

后续 `main` 发布必须先通过 CI 根据变更范围选择的门禁；无法识别范围时运行完整门禁，只有影响生产产物或 migration 的变更才进入 deploy job。正式发布或 migration 前，本地运行全量超集 `npm run check:full`；先运行 `npm ci` 和 `npx playwright install chromium webkit`（本地 Linux 可使用 `--with-deps`；常规 CI 使用固定预装镜像，见 [环境说明](ci.md#本地浏览器检查)）。`npm run check` 不包含 PWA 更新交接及加载性能，不能作为发布前的完整集合。
deploy job 在生产锁内核对发布顺序，记录发布尝试，在汇总 verify 通过后，下载 integration 封存的原始产物并校验完整清单，再执行 D1 恢复点记录、旧图片 Queue consumer 定向解绑（见 [退役顺序](image-renderer-retirement.md#生产退役顺序)）、migrations、迁移后聚合/结构核查、Wrangler deploy 与线上机器验证。迁移或验证失败时 workflow 失败，不能记为发布成功。部署阶段不重新构建。

构建身份、HTML meta、Worker 须匹配显式 expected SHA；实际脚本逐个核对已验证发布包 `dist/client/build.json` 中的 SHA256（包括入口、共享与延迟加载脚本及 PDF Worker）。独立验收需下载对应 artifact；CLI 第三个参数可指定该清单路径，不能使用另一版本的本地构建。全部返回同一个旧版本仍失败。验收最多 12 次、每次请求超时 15 秒、间隔 3 秒，超过传播窗口则保留失败。成功记录只能在这些检查全部完成后写入。迁移后的失败尝试仍推进发布边界；旧作业不能在它之后部署旧 Worker。

### 固定来源的受控手动入口

`controlled-release.yml` 只接受本仓库 `main` 上的 `workflow_dispatch`，确认输入必须为完整
`8909b335284dd4affebc4ce26bccf76f2439f6ef`。这是一次已批准来源的恢复入口，不接受任意
SHA、run、artifact、URL 或强制降级参数，也不修改正常 CI 的范围判断。

固定来源为成功 CI [39384186793](https://github.com/clydian/same-page/actions/runs/39384186793)
attempt 1、workflow ID `345732692`、artifact `12247185579`，ZIP SHA256 为
`17ec872271fdaf8ba3f2e72f755e7dbfe20c5dd63c296b026986c8552cd74d84`。
校验仓库身份、push/main、源 SHA、完整成功 job 集合（deploy 应跳过）、产物归属、大小、摘要与有效期。
该产物原定于 2026-11-03 07:05:38 UTC 到期；缺失、过期或 CI 证据改变时失败，不重新构建或静默改用其他来源。

独立 `validate` job 没有 production environment 或生产 secrets，只为本次 job 的短期
`GITHUB_TOKEN` 增加 `actions: read`，用于读取旧 run 和下载原始 ZIP；不新增长期 token。
它校验 ZIP 和封存清单，再将原始 ZIP 字节以当前 run 的短期 artifact 转交生产 job。
生产 job 不设置跨 run 下载 token，权限仍为 `contents: read`、`deployments: write`。
它再次校验固定 ZIP 摘要、SHA、源 `release.json.runId` 和逐文件摘要；使用固定源码及其锁文件，
不将 workflow 的 `GITHUB_SHA` 冒充为源 SHA，不重建产物。
发布记录 payload 的 `runId` 指向原始封存 CI，状态记录的日志 URL 指向本次手动运行，分别保留产物与执行来源。

生产 job 复用 `production` environment、`same-page-production` 锁、既有 Cloudflare secrets
与发布记录。锁内先通过发布顺序准入，再执行原有恢复点、退役 consumer、迁移前后核查、回填、
部署及显式目标 SHA 的线上验证，最后记录成功或失败。较新发布已准入时，旧目标明确失败，
不会以跳过包装为发布成功；没有自动回滚或绕过开关。取消/runner 丢失可能留下 in_progress，
仍推进发布边界，维护人员须按原 run 核查真实结果。

**2026-10-20 实现时状态：** main 已推进至 `39a1a6ce012910d28856802467c35bab295ffb41`，
既有 CI `39386745941` 已在 07:40 UTC 部署该版本；Cloudflare deployment
`5bf6de47-cb95-420d-8bc6-e9e179afdf8a` 的 100% version 为
`eb1ae9d7-e4a5-40fc-9379-fc687b35a149`。它比批准目标更新，因此此固定入口预期拒绝
`8909b33`，不能用来覆盖当前生产。若要发布其他来源，必须重新批准并以代码审查更新固定策略。
仅打开此入口的 PR 不会触发手动发布；合并与实际执行分别需要明确授权。

## 每次发布记录

在对应 Issue 或 PR 中分别记录：

| 门槛 | 可接受证据 |
| --- | --- |
| 代码 | commit、PR、`npm run check:full` 结果（按范围 CI 的本地全量超集，不代表部署或实机验收） |
| CI | verify 与 deploy job 的 workflow URL 和结论、artifact ID/digest、release.json SHA 与文件摘要 |
| Cloudflare | Worker deployment ID、D1 migration 状态、R2 绑定 |
| 生产 URL | 显式 expected SHA；Worker、build.json、HTML 与脚本身份一致；HTTPS、manifest、Service Worker、未登录 401 |
| 第三方登录 | 提供方审核状态、回调配置、入口可见性、真实 Google 一次成功与取消返回 |
| DNS | `samepage.clyapps.com` 的解析与证书；不得改动根域邮件记录 |
| 邮件 | QQ、163、Gmail、Outlook 各一次真实 OTP 到达与延迟；不记录 OTP |
| 人工验收 | iPad Safari、Android 平板、大陆真实网络的设备、浏览器版本与结论 |

## 人工验收脚本

每台目标设备至少完成一次：

1. 以未安装网页打开，登录并进入乐谱；再安装 PWA 重复核心路径。
2. 切换翻页与连续滚动，验证触摸/手写笔在阅读模式不产生批注。实际快速划动、停住后松手及双指缩放，检查惯性手感、阅读位置和滚动是否被覆盖层阻断；不规定浏览器原生惯性的精确位移、速度或衰减时间。
3. 进入编辑后确认默认文本工具；验证文本、画笔、橡皮和完成编辑。
4. 下载离线副本，断网并重启；确认 PDF、共享层和个人层可用。
5. 离线编辑后恢复网络，手动同步并确认待上传数归零。
6. 制造同一对象冲突；确认冲突只在提交设备本地出现，云端仍只有规范版本。
7. 在存在待上传或冲突时退出；确认必须明确取消或丢弃。
8. 用户 A 的会话自然过期后继续离线编辑；以 A 重新登录，确认原草稿可同步且待上传数归零。
9. 用户 A 的会话自然过期后，在另一标签页以用户 B 登录并打开同一乐谱；确认所有旧标签页立即停止显示或提交 A 的个人层、草稿、冲突与权限缓存。
10. 分别验证访客进入注册用户、同一用户多标签页和主动退出后的路径；确认工作区不互相提升，主动退出后仅保留只读共享离线内容。
11. 在乐谱 A、B 分别离线编辑并退出阅读器；恢复网络或把应用切回前台，不重新打开 A、B，确认两份待上传内容都到达云端。随后让 A 暂时不可用并重复，确认 A 的原 `opId` 与 payload 留在本机、B 仍可完成同步，且没有自动 pull 未打开乐谱的新批注。
12. 发布新版本后保留旧页面，确认显示当前运行版和准备版；前台首页、云盘、曲库或关于页在闲置且无输入、弹窗或任务时可以自动更新。阅读、编辑、上传、播放及忙碌或未响应窗口必须阻止切换；手动更新只绕过闲置等待。可响应且安全的后台窗口可以确认交接，但要等回到前台且安全后才重载。
13. 在认证首屏确认邮箱表单仍在上方；完成 Google 登录，并取消一次；确认成功后续接原访客云盘流程，取消后邮箱草稿和原入口上下文仍保留。

14. 从公开体验分别打开主 PDF、MusicXML 和音频「边听边看谱」，在未登录及 Google／邮箱登录后确认试写只保存于本机体验层、刷新后仍可读回、不创建云端个人层、不上传且不自动迁入账号。遗漏体验参数的非成员入口由服务端确认后回到体验模式；普通云盘伪造参数不得试写，访客点击编辑提示登录并加入。维护示例的有效成员通过正式入口仍按授权编辑共享层。
15. 管理员打开「管理 → 邀请码」查看当前码，关闭重开仍可查看；旧码仅有校验值时补录原码并确认原码继续有效，主动轮换后确认旧码失效。

PDF.js legacy 仍要求 `Promise.withResolvers`，缺失时须验证 `engine-unavailable` 和原 PDF 下载；具体能力探针见 [运行资源说明](../runbooks/pdf-rendering-assets.md#legacy-支持边界)。Safari 17.5 真机尚未验证。

真实 Safari、PWA 存储驱逐、手写笔和大陆网络表现不能由桌面自动化或 WebKit 模拟替代。

## 发布失败与显式回滚

发布封存和部署 Worker、静态资源、迁移与锁文件。
历史 Durable Object 创建和删除 migration 保持原 tag 与顺序，供已部署实例继续升级。
首次发布 #156 前必须在合并前阻止旧图片任务、排空队列并等待在途任务结束；`0025` 将注册派生 key 排入删除队列后 drop 图片表。完整顺序见 [资源退役步骤](image-renderer-retirement.md)。
恢复使用同一 release artifact 和串行 production admission，禁止重新构建后覆盖旧 SHA。

1. 先在 Actions 确定失败阶段。准入跳过表示已有更新的发布尝试；历史不可达、分叉、GitHub 记录不可用或 artifact 校验失败都在生产写入前停止。不要通过删除发布记录或修改 expected SHA 绕过。
2. 下载失败或 artifact 过期：重跑包含 integration、verify 和 deploy 的完整工作流。相同 SHA 允许重试；不允许在部署阶段临时构建一份新产物。`npm run deploy` 仅供已获授权的手工恢复，要求 `SAME_PAGE_RELEASE_SHA` 与已校验的 release.json 一致，不构建、不迁移，也不替代完整发布流程；执行时须停止并发 CI 发布并单独记录。
3. 迁移失败：使用本次步骤记录的 D1 Time Travel 恢复点和迁移前聚合结果，先确定哪些迁移已应用。保留非取消的部署锁，不要在迁移过程中启动另一次写入。修复幂等迁移后重试同 SHA 或发布后继修复。
4. Worker/静态资源上传或线上身份验收失败：检查 expected SHA、上传 artifact、线上 health/build.json/HTML/脚本各自版本与 Actions 原始错误。传播超时不能写成功；可重试同 SHA 的 deploy，仍须重新执行恢复点和迁移核查。
5. 代码回滚采用新的 `git revert` 提交，经过完整验证和同一发布链路向前发布，使发布顺序仍单调。先核对回滚代码与当前 schema 是否兼容；迁移不兼容时先设计明确的数据恢复/前向修复，不能直接用旧 Worker 覆盖新 schema。恢复 D1 是单独、明确授权的生产操作，应说明可能丢失恢复点之后的数据并核查 R2 一致性；本工作流不会自动恢复数据库。
6. GitHub 发布记录缺失或历史分叉时，先重建可信版本证据并恢复正常 main 历史；正常发布不提供强制忽略开关。首次启用记录时只读核对线上 Worker SHA，必须能在完整 Git 历史中解析。

默认通过 CI 发布。手工恢复完成后须记录源码、artifact、D1、Worker deployment ID 和独立线上验收；恢复点、流水线通过、外部身份提供方成功和实机验收各自独立。

## 稳定版／测试版前端通道（#539）

实现见 ADR-0021；本地开发和首次桥接默认 `RELEASE_CHANNELS_ENABLED=false`。
这不是部署授权。不得直接打开开关而跳过以下过渡，也不得把仓库的 research
探针当作生产验收。WebKit 的隔离持久 profile 已通过 Blob 回切探针；真实 Safari/iOS 与 Android TWA 实机仍必须单独记录。
关闭 runtime flag 仍会部署配置中的 R2 binding 与 Worker-first 路由；首次合并部署前一并核对 bucket、IAM 与路由，不能把开关关闭等同于没有部署影响。

手工执行 `upload` / `initialize` 前，运行 `npm ci`、`npm ci --prefix android` 和
`npx playwright install --with-deps chromium webkit`，确保两引擎与系统依赖齐备。常规 CI 的发布 job 使用同版、固定 digest 的 Playwright 预装镜像，并实际验证两引擎启动，不再实时安装系统包。

### 首次桥接（需另行授权）

1. 创建专用私有 `same-page-frontend-releases` R2 bucket，关闭公共访问及所有 TTL／生命周期删除；
   将部署 token 的 R2 权限纳入该桶，不与乐谱／APK bucket 共用清理规则。
2. 按现有受控发布链路应用 `0034_release_channels.sql`（仅新建服务端表）；保留现有
   当前 production 静态资源和旧 SW 地址作为明确支持的 legacy 基线。下载原始封存包后运行
   `node scripts/frontend-release.mjs archive-legacy <旧SHA> --archive-supported-baseline`，
   first-write 归档旧静态路径；不同摘要同路径必须人工处理兼容性，不能覆盖。不要回收已有应用壳。
3. 使用 `SAME_PAGE_RELEASE_CHANNELS=1` 构建并封存桥接提交的原始产物。**不要重新构建重试**；
   同 SHA 不同文件摘要必须拒绝。先执行 `node scripts/frontend-release.mjs upload <SHA> --initialize-stable`
   上传完整候选，再部署该桥接包，保持 Worker routing flag 为 false，使已有客户端安全过渡。
4. 下载并验证这一份完整发布包，`npm ci --prefix android` 提供已有 S3 SDK。
   用 `node scripts/frontend-release.mjs initialize <完整SHA> --initialize-stable` 上传封存并验证固定
   资源后，将 stable/beta 同时初始化为该 SHA。命令要求线上后端也为这份 SHA；
   任何线上验收失败都不能初始化指针，不会自动恢复数据库。
5. 完成 legacy active/waiting、直接深链、全新安装、离线恢复、Safari/iOS 和 TWA 验收，
   再通过受控部署将 runtime `RELEASE_CHANNELS_ENABLED:true` 应用到**同一份产物**，
   并设置 GitHub production 对应 repository variable `RELEASE_CHANNELS_ENABLED=true`。
   新版本须通过下述持久格式边界检查及实际产物回切矩阵才准入 beta。
6. `npm run admin:configure -- grant-release --remote <userId>` 单独授权发布人员；
   `revoke-release` 撤销。该 CLI 从不按邮箱授权、不修改成员关系；只在另行批准时运行。
   授权者在 `/admin/releases` 查看两通道、北京时间发布时间和审计，再提升明确显示的当前目标。

初始 bridge 的旧根资源需要归档并保持原地址；新版本一律使用 `/_releases/<SHA>/`。
缺失稳定目标返回错误／重试，禁止自动使用测试版。所有角色的 API、OAuth callback、
`.well-known/assetlinks.json` 与 APK 端点保持原协议边界。

### 日常发布与恢复

CI 在生产锁内先校验完整包，再 `frontend-release.mjs upload <SHA>`：比对当前 stable 的
持久格式边界、first-write claim、逐文件写入／读回与最终 seal。边界仅涵盖明确列出的业务
IndexedDB／共享同步表示及 Dexie、Zod 版本；UI、普通实现依赖和兼容 D1 migration 不再要求
源码字节相等，具体清单见 `scripts/release-contract.mjs`。业务 schema 或共享同步表示变化
仍须另审兼容桥接。旧版封存清单可按相同
边界比较，不能重写旧 seal 或用手工忽略关键字段绕过。
上传前另从 R2 下载当前 stable 的封存私有 storage probe，与 candidate 原始 probe 在
Chromium/WebKit 全新持久 profile 中跑 `stable → beta → stable → beta`：实际草稿、队列、
push/pull 合并器、Blob、冲突、已尝试操作和身份保留。报告绑定两个 probe 摘要与 stable 身份，
写入 R2 和 D1 `release_compatibility`，缺失／篡改／目标不符均拒绝准入；报告不能以手写 passed
替代执行。脚本未访问真实用户数据；WebKit 不能使用有原生 Blob 限制的 ephemeral context。
部署后以固定前端 URL 检查字节并独立核对后端 SHA，成功后 `frontend-release.mjs admit <SHA>`
再次校验资源并 CAS 推进 beta。stable 保持不变；目标或 revision 变化则失败，重新验收。
后台提升仅写 D1，既不重构建也不执行 migration。

提升请求具备幂等 ID；网络丢响应可重试同一次操作。409 后必须重新读取并确认版本，
不能重用旧按钮悄悄提升新 beta。管理员授权与 session 在提交时重新校验。

### 停止故障 beta 继续分发

适用于 beta 已准入但出现前端故障、当前 stable 仍可正常使用的情况。沿用生产运维 token，
不需要增加产品后台入口或发布权限体系；执行本步骤属于生产操作，仍须有明确事故授权。

1. 暂停后续 CI 发布并等待当前生产发布结束。在已授权后台读取当前 stable、beta 和 revision，
   记录操作者、原因、时间及后端身份；确认 stable 正常，不凭缓存页面中的旧值操作。
   若 beta 已等于 stable，就不需要执行停止命令。
2. 使用同一份受控源码及既有生产凭据执行：

   ```sh
   node scripts/frontend-release.mjs stop-beta <当前beta完整SHA> --expected-revision=<当前revision>
   ```

   命令只在 beta 与 revision 仍匹配、两通道目标不同、当前 stable 已 ready 且契约匹配时将 beta
   指向 stable，并增加 revision。
   条件变化时明确失败，重新读取后再决定；不能用强制更新覆盖新发布。它不构建、不迁移、不删
   产物或业务数据，也不提供任意历史目标。
3. 重新查询两个通道，确认 stable 未变、beta 已等于 stable，把结果与命令输出记入事故记录。
   beta 偏好仍保留，在线客户端沿原安全交接流程准备 stable；正在编辑或播放的页面不强制刷新。
   已缓存及离线客户端无法即时撤回，必要时直接通知少量受影响用户在安全时机联网更新。
4. 仅放行新的兼容修复提交通过正常 CI 发布，验证成功后恢复后续常规发布；下一次合格版本
   按原流程推进 beta。不要用 `admit` 重新准入故障旧 SHA。
   若故障 stable 也不能继续分发，由运维在事故授权下暂停入口并返回 no-store 维护响应，直至
   修复上线。不得覆盖旧 R2 对象或回退 D1。

此阶段不提供任意历史选择、自动 GC 或破坏性数据回退。

本地验证：`npm run test:release-channels`、常规 `npm run check:full`，以及
`SAME_PAGE_RELEASE_CHANNELS=1 npm run build` 的前缀资源完整性检查。生产桶、权限、移动端
实机与线上流程不由这些命令代替。诊断同时记录所选通道、运行前端、准备目标和后端身份。
