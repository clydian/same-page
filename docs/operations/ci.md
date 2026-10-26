# CI 检查与开发反馈

PR 更新触发按变更范围选择的检查，同一 PR 新运行取消旧运行。`main` push 验证实际合并结果；生产部署继续串行，迁移和部署不被后续 push 中断。原有 required check 名称 `verify` 保持不变。

2026-10-23 实际启用了 GitHub branch protection：必需检查为 GitHub Actions
（app id 15368）的 `verify`，并开启 `strict=true` 和管理员约束。2026-10-25 已通过 GitHub API 调整为
**保留必需的 `verify`，关闭必须跟上最新 main 的要求**（`strict=false`，GitHub 的 loose 模式）。
这样一批 PR 的当前版本各自通过必需检查且满足其他合并条件后，可以逐个合并；前一个 PR
使 main 前进，不再仅因此要求后面的 PR 更新分支并重跑。新增提交仍须满足检查，失败或取消
不作为成功放行；冲突和未解决讨论仍需处理，管理员约束及禁止 force push/删除的配置保留。

这个取舍允许两个单独通过检查的 PR 在组合后出现问题。main push 的 CI 继续验证实际合并结果，
部署继续受 `verify`、发布范围和通道开关控制；main 失败时暂停后续批量合并，修复或回退问题提交。
关闭 strict 不保证 main 始终为绿，也不等于 GitHub auto-merge 或合并队列。

### GitHub 设置与回读

分支保护保存在 GitHub 仓库设置中，提交或合并仓库文件不会自动改变这些设置。
2026-10-25 已实际执行以下 PATCH，并回读确认 `strict=false`、必需检查仍为
GitHub Actions 的 `verify`（app id 15368）；管理员约束、讨论解决要求及禁止强推/删除保持原值。

```sh
# 只修改 strict 字段，保留现有必需检查及其来源。
gh api --method PATCH repos/clydian/same-page/branches/main/protection/required_status_checks \
  -F strict=false

gh api repos/clydian/same-page/branches/main/protection/required_status_checks \
  --jq '{strict, checks}'
```

预期结果为 `strict: false`，`checks` 为 `[{"context":"verify","app_id":15368}]`。
需要恢复严格模式时，对同一端点执行 `PATCH -F strict=true`，再回读确认。
这份文档记录已应用的策略及操作方法，不会由 CI 自动同步或覆盖 GitHub 设置。

GitHub 官方说明：[strict 与 loose 必需检查](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches#require-status-checks-before-merging)。

### 诊断证据

scope 的日志与 summary 记录实际 checkout SHA、Git tree、parents、比较 base、event、attempt
和 Node 版本；squash 前后 SHA 不同是正常情况，判断同代码重跑必须比较 tree、scope 与运行环境。
重跑不代表修复，首次失败单独保留；不为业务断言增加自动 retries 或放宽阈值。

platform 的合成 PWA 检查保留 `DEBUG=pw:browser` 原生浏览器 stderr 与退出信息，
以及可读取的 cgroup 内存计数前后快照，位于 artifact 的 `platform-runtime/`。
这用于区分脚本网络失败与浏览器进程/IPC 异常；没有进程或 OOM 证据时不能归因于 runner。
日志管道保留原始非零退出码，不增加重试。生命周期失败的严格缓存审计仍然阻止 `verify`。

## 流程

`scope` 不安装依赖：运行 CI 范围回归测试，然后比较完整 Git diff。checks、backend、visual 和 build 同时启动；smoke/platform 等待 build 的统一构建产物（仅 PWA 时不需要构建产物），各自只执行选中的步骤：

| Job | 职责 |
| --- | --- |
| `checks` | lint、typecheck、Node/组件测试 |
| `backend` | 按 scope 顺序运行 Worker 与迁移验证；与前端检查并行，数据库保持独立隔离 |
| `visual` | 4 个独立 runner 文件分片，Chromium/WebKit 布局与交互回归 |
| `build` | 统一生产构建、封存校验产物；不等待浏览器环境安装 |
| `platform` | PWA 双版本交接、下载并校验生产产物后测量加载预算 |
| `smoke` | 下载并校验同份产物，2 个独立 runner 文件分片运行真实 Worker/D1/R2 流程 |
| `verify` | 等待以上全部结束；被选中的 job 必须成功，未选中的必须为 skipped；失败、取消、意外跳过均不能通过 |

`checks` 在安装依赖前先运行发布存储边界预检及其回归，用经审查的 stable 封存清单
提前发现 Dexie/Zod 或共享持久格式边界变更。预检不使用生产凭据；部署仍核对实际 stable。
基线来源和更新约束见[发布说明](production-release.md#日常发布与恢复)。

日常部署仅在 `verify` 成功、本次 main 变更需要发布且 repository variable
`RELEASE_CHANNELS_ENABLED=true` 时运行。首次通道桥接期间该变量保持关闭，main 继续完整验证并封存产物，
`deploy` 明确跳过；只有手动 `bootstrap-release-channels.yml` 可以准备桥接版本。此冻结也防止后续 main
覆盖尚待实机验收的基线。CI 成功和 deploy skipped 不表示已部署，首次流程见
[首次桥接](production-release.md#首次桥接需另行授权)。

并行降低等待时间，但重复的 runner 启动和安装可能增加总执行分钟；不是降低账单的承诺。分片保持有限数量，避免为每个小测试创建 runner。visual 矩阵最多并行 4 份，smoke 最多 2 份；任一分片失败不会取消其余分片，但汇总失败会阻止 verify。

## 范围选择

不使用顶层 `paths-ignore`，避免 required check 长期 pending。PR 比较当前合并提交与 base 的共同祖先；push 比较事件 `before` 到当前提交，包含一次 push 的所有提交。禁用 rename 检测以同时检查新旧路径，NUL 分隔支持特殊文件名，不受 GitHub 顶层过滤的 300 文件限制。

| 改动 | 选中的检查（非文档改动始终 lint/typecheck） |
| --- | --- |
| `README.md`、`CONTEXT.md`、`AGENTS.md`、`docs/**/*.md` | diff whitespace |
| `docs/operations/` 内 PNG/JPEG/WebP、子目录 `evidence.json` | 同上；这些审查证据不被应用或构建读取 |
| 客户端生产代码（下列展示叶子模块除外） | 客户端、完整视觉、构建、加载预算、完整真实存储 smoke |
| 仅 drive-settings-dialog / drive-header / upload-fab（可混合文档） | 客户端、library 视觉组、构建、入口/离线存储 smoke；不运行加载预算 |
| PWA 入口/导航/更新提示、app、auth/offline/platform 生产代码 | 客户端路径加真实 PWA 双版本交接 |
| Worker 生产代码 | Worker、构建、真实存储 smoke |
| 共享运行时代码 | 客户端、Worker、视觉、构建、加载预算、smoke |
| 客户端/Worker 测试 | 对应测试，不构建、不部署 |
| D1 migration | Worker、迁移、构建、smoke |
| 视觉测试文件、视觉 setup | 视觉测试，不构建、不部署 |
| 共享浏览器 fixture 代码 | 视觉、构建、加载预算、smoke |
| 常规生产工作流 `.github/workflows/ci.yml` | 完整验证；main push 选择部署，仍受首次桥接冻结与 runtime 开关限制 |
| 依赖、构建配置或未知路径 | 完整验证 |

多个路径取检查的并集。未知事件、缺失历史、空 diff、不可识别文件均回退完整验证。文档中的 JS、未知 JSON、运行时图片仍不属于轻量白名单。如果将来运行时或构建开始消费审查证据，必须先更新分类器。

共享或未知验证脚本保守运行全部验证，但不自动部署。生产客户端、Worker、共享代码、静态资源、migration 和常规生产工作流 `ci.yml` 的 main push 选择部署；是否实际执行还受上述通道桥接冻结限制。其他 CI 工作流、测试和验证脚本本身不触发部署。`ci.yml` 的注释修改也按同一文件级规则验证发布。完整规则以 `scripts/ci-scope.mjs` 为准。精确模块、消费者和 library 测试组见 [#174 审计](test-audit-174.md#模块与-ci-选择)。仅全部改动都属于展示叶子模块或文档时才收窄；混合其他路径回到 all。选择器自身变动执行完整验证。

## 测试的职责

本轮重复矩阵精简及 CI 瓶颈判断见 [2026-10-10 审查](test-value-audit-2026-10-10.md)。此前测试价值边界与逐文件判断见 [2026-09-09 审查](test-value-audit-2026-09-09.md)。常规 CI 保护应用自己的行为和平台集成：原生触摸能滚动、批注不漂移、离线与权限正确；不验证浏览器惯性曲线、营销布局左右顺序或固定装饰间距。精确时间只用于应用自己的截止期限、过期/重试规则或可控的逻辑时钟。加载脚本保留各阶段测量、身份校验和粗粒度预算，移除单次缓存返回 200ms 与重开必须快于冷开的判断；缓存复用与返回不等网络由受控挂起响应的功能测试保护。

新增测试应说明它阻止的用户损失、现有覆盖的缺口以及最低成本的可靠验证层。诊断期间的对照实验不自动转为永久门禁；删除或合并时记录保留的风险覆盖。布局断言优先检查可达、遮挡、溢出和触控区域，不把当前排版实现固化成产品规则。

测试是否保留，以可观察错误及独立覆盖为标准，不以 TDD 来源、用例数量或覆盖率百分比为标准。清理结论与保留风险见 [测试审查记录](test-audit-2026-09-06.md)。

2026-10-23 后续清理删除五个只比较退役 player/native tarball 的历史差分测试；
历史制品与源码归档保留。当前包行为、release-artifact、迁移和兼容检查继续运行，
`packages/player/test/native-source-distribution.test.mjs` 保护当前安装包 peer、源码摘要、
不可变输出，并核对实际发布的 license/notice 原字节。
浏览器 retention 每组保留三次更新，足以跨过 current/rollback/candidate 回收边界；
纯策略层的二十次循环保留。缓存数量上限、真实 BFCache、跨窗否决、草稿与 lazy chunk 断言未放宽。
关闭回收的临时错误注入在第三个候选时仍会失败，避免以减少次数制造空转门禁。

### 体验笔记与练习谱的独立场景

`preview-notes-smoke` 按访客登录/PDF、连接提示变化、已登录 XML、已登录音频、
无 experience 参数的直接链接分为五项；每项独立 browser context、IndexedDB、请求/错误记录和失败证据。
保留实际登录的身份转换，明确断言访客笔记不会出现在已登录体验中；每项仍执行真实 PDF
落笔、刷新后可见、云端仅有不可编辑共享层，以及无笔记/个人层写请求、无页面错误的验证。

`musicxml-startup` 按准备中切换 PDF、prepared 复用、刷新后 local 原文/目录边界、
本地访问超时后的显式保存恢复、普通音频分为五项，每项独立持久化 profile。prepared/local 场景自行完成首次网络准备，
不依赖前一项留下的缓存；每次打开仍验证真实音符、一次 MIDI 生成、一次新授权及精确原文请求次数。
普通音频从全新 profile 打开，仍禁止加载 XML 引擎/音色资源。两文件只共享本引擎只读后端种子数据
和正常登录所得 cookie，不共享本机数据。保留每引擎原有 180 秒总预算、两种引擎和原等待上限。

失败证据分别位于 `preview-notes/<engine>-<scenario>/` 与
`musicxml-startup/<engine>-<scenario>/`。用 Node 原生完整名称过滤可单独运行，例如：

```sh
# 先准备与 smoke 一样的生产构建；以下过滤只用于本地定位，CI 默认全量运行。
SAME_PAGE_RELEASE_CHANNELS=1 npm run build
node --test --test-name-pattern='^webkit: MusicXML startup local-directory-boundary$' browser-tests/musicxml-startup.test.mjs
node --test --test-name-pattern='^chromium: preview notes stay local signed-in-direct-link$' browser-tests/preview-notes-smoke.test.mjs
```

个人菜单的云盘内/外及可管理身份的条目和链接合同集中到 `personal-menu.test.tsx`；
两个浏览器文件删除重复条目全集与旧入口缺席检查。浏览器仍验证实际关于页/首页跳转、Escape
焦点恢复、云盘选择器边界、长邮箱窄屏无溢出及 End 键可达退出操作。
本批不改 PWA 更新/生命周期脚本、共享存储 fixture、浏览器分片或范围选择，避免改变 #564 的调查条件。

- `npm test`：Node 规则和 jsdom 组件。客户端纯逻辑文件用 `*.node.test.ts` 命名，由 `vitest.node.config.ts` 收集，不启动 DOM、React cleanup 或 IndexedDB setup。jsdom 使用单个 setup hook，先卸载 React 再清理 IndexedDB，保持逐用例数据库隔离。
- `npm run test:worker`：纯认证配置/安全逻辑在 Node，真实路由、D1、R2、权限与生命周期在 workerd。保留实际迁移初始化和隔离，不为省时间改成共享可变数据库。MSW 3、Vitest 5 与 Cloudflare 测试插件保持兼容的 peer 组合；Worker 集成测试关闭 `fsModuleCache`，避免 Workerd 读取宿主机的模块缓存路径。
- `npm run test:browser-ui`：Node 原生 global setup 只启动一个隔离 Vite dev 服务，每台最多两个文件并行。各测试仍独立拥有浏览器 context、IndexedDB、API route 和 fixture session；没有重试。直接 `node --test visual-report/<file>.test.mjs` 仍可独立启动服务。
- `npm run test:smoke`：必须先 build。通过与 CI 相同的 runner 在每个分片内串行运行有状态文件，避免多个 Vite/workerd 优化器争用；每次 fixture 调用有独立真实 D1/R2，验证生产 API、PDF 字节、下载、浏览器关闭重开后的离线副本、批注并发和诊断提交；不改成 API mock。

视觉回归保留两种浏览器引擎、最窄视口、关键断点两侧、横竖屏、200% 文本、44px 点击目标和真实内容溢出断言。相同完整流程不重复遍历每个设备商品名；这些都是模拟视口，不代表实机验收。

## 产物与发布

PWA 测试在 Chromium/WebKit 验证首页动画的按需缓存和静态离线兜底；构建审计限制应用壳预缓存为 7 MiB，并保留 PDF 离线依赖检查。预算、缓存生命周期与回归职责见 [预缓存说明](pwa-precache.md)。

platform 的 PWA 测试构建 `pwa-e2e-first`、`pwa-e2e-second` 并验证真实 Service Worker 交接。build 独立构建真实源码；platform 测量加载预算前移除合成 dist、下载并校验真实构建包。smoke 在另外两台 runner 使用同份包，与 PWA/加载检查并行；合成版本不得发布。`npm run test:loading-performance` 单独执行时仍先 build。

需要构建或 smoke 的运行（包括 PR）封存并上传 `release-<SHA>`；两个 smoke 分片下载同次运行的包，提取后先校验 SHA256 清单与源码 SHA，再启动浏览器。PR 包只供本次验证，deploy 仍只允许需要部署的 main push，并等待 checks、全部 visual/smoke 分片及 build/platform 的汇总 `verify` 成功。部署下载同次运行的产物，校验 SHA256 清单，直接发布而不重建。产物保留 14 天；过期需重新验证生成。visual/smoke 各分片使用独立 artifact 名称，platform 也保留 `artifacts/verification/` 的已有合成证据，失败时也上传，不能放入生产会话或私人内容。

build 固定 `SAME_PAGE_RELEASE_CHANNELS=1`，产物使用 `/_releases/<SHA>/` 并包含通道选择能力。
这与 Worker runtime `RELEASE_CHANNELS_ENABLED` 分开控制；不能因为需要准备通道包就开启生产路由，
也不能在重试时重建同一 SHA。首次手动流程从成功 main CI 下载两个原始 ZIP：桥接版本和明确支持的
旧生产基线。无生产 secrets 的 validate job 核对完整 CI、artifact 归属、摘要与封存身份，并运行两份
实际 storage probe 的 Chromium/WebKit 转换矩阵。production job 在既有生产锁内再次校验，
以原字节完成归档、上传、runtime=false 部署、线上验收及 stable/beta 同版本初始化。
该 workflow 只有 prepare，不提供 enable 入口；实机验收前保持普通 main 部署冻结。

`npm run check` 运行所有常规检查；`npm run check:full` 再包含 PWA 更新及加载预算，是本地验证超集。生产身份、准入与锁见 [交付契约](delivery-contract.md) 和 [发布流程](production-release.md)。

## 浏览器分片

`scripts/run-browser-tests.mjs` 自动扫描文件，通过 `scripts/browser-test-selection.mjs` 选择 all/library 范围并排序，随后交给 Node 原生 `--test-shard=index/count` 按文件均分。没有耗时权重、历史数据或手工分片名单。新文件自动加入 all；library 仍是按消费者审计的显式范围名单。非法参数、缺失 library 文件或文件数少于分片数都会失败，不能静默空跑。

文件数量均分不保证运行时间相同；接受这一差异以减少维护成本。各 runner 使用相同源码、同一排序后的候选列表，Node 负责分配。回归通过真实 runner 验证分片并集完整且互不重复，包括新增文件。

本地不传分片时仍运行完整范围。可单独运行：

```bash
node scripts/run-browser-tests.mjs visual all 1/4
node scripts/run-browser-tests.mjs smoke library 1/2
```

拆分保留全部测试、引擎、断言和原有同机并发，不代表减少总计算时间。独立 runner 拉取固定浏览器镜像并安装 npm 依赖；产物下载与 smoke 等待构建也会进入关键路径。修改后按 Actions 实际耗时和失败率评估，不承诺线性加速。

## 本地浏览器检查

本地首次运行浏览器测试前安装两个引擎；本地 Linux 可加 `--with-deps` 安装系统依赖：

```bash
npx playwright install chromium webkit
```

CI 的 visual、smoke、platform、常规发布、首次桥接 job 及稳定性实验使用与锁文件同版、固定 digest 的官方
Playwright Noble 容器，保留 Node 24；不在测试 job 临时执行 apt 或下载浏览器。
安装 npm 依赖后执行 `.github/scripts/verify-browsers.mjs`，核对版本、Python 取证依赖和
两引擎真实启动。Playwright 升级须同步更新 `ci.yml`、`bootstrap-release-channels.yml` 与 `browser-stability.yml` 的全部
镜像版本和 digest。原始失败、取舍与验证边界见 [环境准备记录](browser-test-stability.md#ci-环境准备--391-与-2026-10-22-后续修复)。

发布容器在 checkout 后、准入前，将当前 `$GITHUB_WORKSPACE` 精确登记到作业 HOME 的
Git `safe.directory`；checkout 自身的登记只存在于它的临时 HOME，不能供后续发布脚本使用。
`test:ci` 通过真实 Git 所有权检查和发布准入 CLI 验证此边界，其他目录仍保持不受信。

完整检查会启动
本地 workerd/Vite、临时 D1 和浏览器，并多次构建；不需要生产凭据，不操作生产数据。
`check:full` 不应与其他构建命令在同一工作目录并行运行。

```bash
npm run test:browser-ui
```

浏览器布局与交互测试继续存放于 `visual-report/`，内部 runner 和 CI job 仍使用 `visual`
标识。该目录不再生成供人工审阅的整套截图与 HTML 报告。共享请求数据由
`visual-report/fixtures.mjs` 提供；未知 `/api/*` 请求返回 404，避免访问实际业务数据，
由 `visual-report/fixtures.test.mjs` 保留回归保护。测试按需保存的截图与失败证据仍然保留。

UI 改动可按涉及的页面临时截图检查。模拟视口不证明 Safari 工具栏、虚拟键盘、PWA
全屏、安全区或 Apple Pencil 的实机表现，设备验收见
[发布 runbook](production-release.md#人工验收脚本)。

## 安装与性能评估

Node 使用 lockfile 和 npm 下载缓存，安装命令为 `npm ci --prefer-offline --no-audit --no-fund`。不缓存可变测试数据库，不复用未经本次验证的发布产物。

2026-09-06 两次成功 PR 的 verify 用时 740 秒、640 秒，视觉分别 229/206 秒、storage smoke 100/90 秒、依赖安装 18/13 秒。当时瓶颈是串行关键路径、重复浏览器启动与错误范围放大，不能继续把提速主要归因于 npm 缓存。修改后的真实 Actions 数据与本地验证边界记录在测试审查记录及 [#174 后续审计](test-audit-174.md) 中。

参考：[GitHub jobs 与依赖](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-jobs)、[依赖缓存](https://docs.github.com/en/actions/concepts/workflows-and-actions/dependency-caching)、[Node 24 全局测试 setup](https://nodejs.org/docs/latest-v24.x/api/test.html#global-setup-and-teardown)、[Vitest 并行](https://v4.vitest.dev/guide/parallelism)。
