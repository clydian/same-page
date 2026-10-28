# PR 反馈与测试版／稳定版验证分层

调研日期：2026-10-28。本文记录方案研究与决策；PR #600 已按此方案实现测试选择和工作流调整。未改变发布权限或稳定版提升行为，实际操作见 [CI 文档](../operations/ci.md)。

## 结论与推荐

测试的「执行选择」与「失败后阻断哪个阶段」应分别建模。`extended` 表示不阻塞日常测试版发布，不表示开发它的 PR 不需要验证。

建议保留现有核心／扩展分类，调整 PR 选择为：**现有范围内的核心测试 ∪ 新增／修改的测试**；共享测试 helper／基础设施改动作为低频例外，保守扩大两套浏览器验证。合并 main 后对实际合并结果再运行核心门禁，成功后发布测试版；完整扩展检查继续对该测试版候选运行，结果在稳定版提升时使用。不要为了尽早看到某个扩展测试结果而把它永久升为全局核心门禁。

按用户「低风险失败不影响测试版」的目标，建议 **选中的扩展测试仍是 advisory**：

- 核心测试继续是 required；相关扩展测试单独显示真实红绿结果，不纳入阻止测试版的 `verify`，也不通过 `continue-on-error` 把失败涂绿。
- 修复某项行为的 PR，作者应展示对应回归通过，作为 review 的证据要求；这与把所有相关扩展永久变成系统硬门禁不同。
- 稳定版继续展示该候选的完整扩展结果，失败、未完成或缺失必须在提升时明确关注并人工确认。当前用户没有要求增加服务端硬门禁，不应顺带引入例外放行协议／数据库。若以后需要强制成功，再独立决定。

以上是针对本仓库和用户目标的工程建议，不是官方要求所有项目采用的固定模板。

## 一手来源支持什么

1. Google《Software Engineering at Google》的 [Continuous Integration](https://abseil.io/resources/swe-book/html/ch23.html) 将 presubmit、post-submit、候选发布测试分别讨论，建议提交前优先快速可靠的测试，并通过后续测试发现遗漏。其原则支持按反馈速度与风险分阶段，不要求所有 PR 运行所有大型测试。
2. Playwright 官方 [CI 文档](https://playwright.dev/docs/ci#fail-fast) 说明 `--only-changed` 利用测试依赖图尽早反馈，但明确称其为 heuristic，可能遗漏测试，因此仍需完整测试兜底。[CLI 文档](https://playwright.dev/docs/test-cli) 支持 Git ref、测试文件及显式测试列表选择。本仓库使用 Node 原生 test runner，只使用 Playwright 的浏览器能力，不能直接加该参数；也无需为此迁移整个 runner。
3. GitHub 官方 [workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idneeds) 说明 `needs` 决定 job 成功依赖，`continue-on-error` 改变失败的作业结果。非阻塞检查应通过依赖关系／required check 政策体现，而不是隐藏真实测试失败。
4. GitHub 官方 [required status checks 故障排查](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks) 说明必需检查须对应当前提交；被路径过滤跳过的整个 workflow 可能留下 Pending，而被 job 条件跳过的检查可能被视为成功。因此保留始终产出的汇总 `verify`，并核对被计划执行的 job 结果，避免把缺失证据当成功。
5. GitHub 官方 [workflow artifacts](https://docs.github.com/en/actions/tutorials/store-and-share-data) 支持跨 job 共享产物，说明 artifact 不可变及摘要验证。稳定版提升应使用绑定确切候选 SHA／manifest digest 的结果，不能把其它候选、过期或缺失结果当作本版本通过。仓库现有原始产物封存／digest 绑定值得保留。

## 评估时发现的实现缺口

- `scripts/browser-test-selection.mjs` 仅按文件静态分为 gate／extended；它目前没有与 Git diff 做并集选择。
- `.github/workflows/ci.yml` 用 `deploy` 是否为 true 决定 gate 或 all。普通产品 PR 的扩展回归不会自动被选中，而纯测试 PR 会跑完整套件；这是把发布需求与测试选择绑在一起。
- `.github/workflows/browser-extended.yml` 仅在测试基础设施 PR 中提前全量运行扩展，或在 main 实际成功准入测试版后运行。当前 PR #600 因修改选择器而「碰巧」提前覆盖全部扩展，并不是普通修复 PR 的通用机制。
- 稳定版的 `/api/admin/releases/promote` 当前检查候选、权限、revision 和存储兼容证明；扩展检查状态是界面提示，没有服务端的扩展成功硬门禁。若需要强制等待或带理由的例外放行，必须明确设计该政策，不能只改提示文字。

## 最小维护成本的选择策略

第一阶段只做可解释的选择，不自建产品源码到全部 E2E 的精密依赖平台：

1. 沿用现有 merge-base Git diff，完整处理新增、修改、重命名、删除；新增／修改的现存 `.test.mjs` 不论分类都自动纳入 PR。
2. 共享 helper 改动不能漏选调用者：PR #600 的 `join-keyboard-cases.mjs` 同时注册核心与扩展场景。最小 v1 不自建 import 图；helper／fixture／runner 的低频改动保守扩大两套浏览器验证（现有 fixture 已跨目录共享）即可，把这类例外成本讲清楚。保留已经存在、原生支持的 related-test 能力用于低层测试，不为浏览器套件造解析器。
3. 产品实现仅通过 HTTP／页面加载被 E2E 使用，不是测试文件的静态 import。自动测试依赖图因此不能证明一个源码变更影响了哪些浏览器场景。v1 沿用现有粗范围和一次性显式测试选择；仅当运行数据证明值得时，再考虑少量稳定功能域。不要逐个组件维护永久源文件→E2E 映射。
4. 明确输出选中清单及原因（核心／测试变更／helper 消费者／手动补充），去重后分片。空选择、删除测试及无法确定比较 base 分开处理，不能静默漏跑，也不应把每个普通未知业务路径都升级成全部扩展。
5. 对 source-only 修复，开发者应新增或修改回归测试，使其自动进入 PR；如果已有测试无需改动，用明确的文件列表手动补充运行。手工选择是例外通道，不承担永久风险分类。

完整扩展检查是选择策略不完备的兜底；对候选结果保持关联和持续可见，比承诺百分之百的 affected-test 推断更可靠。

## PR #600 的只读清单实验

在当前分支执行现有选择器并与 `git diff origin/main...HEAD` 中仍存在的测试文件求并集：
视觉核心 17 个文件，全套 49 个文件；本 PR 额外修改的扩展文件为
`join-keyboard-extended.test.mjs`，因此基础选择为 18 个文件，而非全套 49 个。
smoke 核心 15 个、全套 35 个，本 PR 没有新增／修改 smoke 测试文件。
这些是文件选择数量，不是用例数，也不是运行时间承诺；基础设施变更的保守扩大另计。

最小落地涉及三处职责：选择器生成核心／相关两份清单和原因；CI 消费同一清单，
保留 required `verify` 与独立的相关扩展结果；现有发布后工作流继续提供完整扩展结果。
移除用 `deploy` 布尔值推断测试范围的逻辑，测试基础设施变更再保守扩大浏览器验证。
不需要迁移 Node runner、重做产物封存或增加新的发布权限／数据库。

## 推荐阶段表

| 阶段 | 执行 | 失败影响 |
| --- | --- | --- |
| PR | 快速规则／组件检查、现有范围核心、新增修改测试；helper 改动保守扩大两套浏览器验证，可补充已有相关测试 | 核心阻止合并；选中扩展单独报告为 advisory，作者以通过的相关回归证明修复。 |
| main → 测试版 | 对真实合并结果运行核心门禁、兼容／迁移／身份／权限／数据安全检查，封存一次构建 | 关键失败阻止测试版；不能只复用 PR 的成功。 |
| 测试版准入后 | 完整扩展矩阵，复用准确候选，记录失败、取消、缺失及证据链接 | 不阻止测试版，保留结果供稳定版评估。 |
| 稳定版提升 | 核对当前候选的扩展结果与真机体验，失败／未完成／缺失必须显式处理 | 维持当前人工确认流程，明确展示失败／未完成／缺失及候选身份；不擅自增加硬门禁。 |

保留当前 Node runner、核心／扩展名单、单一汇总 check 和不可变产物。减少 `deploy=true → gate / deploy=false → all` 的特殊分支，让一份测试计划供执行、汇总和报告共用，避免再建多套分类。
