# CI 可靠性与测试价值审计 · 2026-10-23

建议把 CI 从“所有验证脚本都参与广泛门禁”收敛为“强制合并准入、明确风险责任、可独立复现的核心测试”。优先补 GitHub 合并配置和高频浏览器失败机制，同时删除过时证明与重复矩阵。不要以全局重试、统一增加超时或删除高风险保障来获得绿灯。

审计基线：main `0db9a6fe9100f45120c4e837525fc721cc3dcdb0`。本轮只新增研究记录，没有修改产品、测试、工作流、GitHub 配置或生产状态。

## 调查范围与证据口径

- 读取最近 300 个 CI workflow run，窗口为北京时间 2026-10-14 19:36 至 10-23 11:09。采集最新 attempt 的 job 结果，并下载 62 个最终失败运行中 79 个非汇总失败 job 的日志。
- 追查全部 8 个有第二次 attempt 的运行，读取第一次 attempt 的 job 及 9 份失败日志；不以重跑后的 success 覆盖首次失败。
- 通过 GitHub API 读取 main branch protection、独立 required status checks 端点及 rulesets。
- 对照 #560 的 PR checkout commit、实际合并 commit、Git tree、base 和 scope；读取 platform 失败制品。
- 阅读 CI/scope/浏览器 runner、主要 fixture、PWA 脚本、既有测试审计、相关领域文档及 ADR-0020/0021。两份后台研究分别交叉检查测试价值与 CI 架构/官方文档。
- 本地定向运行 5 个旧制品测试文件：9 项全过，Node v24.21.0，Vitest JSON 记录的运行墙钟约 0.99 秒（不含命令启动）；各文件约 0.46–0.67 秒，并行时间不能相加为墙钟。没有运行全量浏览器测试或做产品故障注入。

这是一个持续有代码、测试和 CI 修复发生的历史窗口，不是固定代码的稳定性实验。失败数量包含真实回归、陈旧断言、环境问题和未定因竞态；**不能将以下失败比例称为 flaky rate**。不同文件运行次数不同，热点计数也不是逐文件失败概率。

## 1. 合并准入存在确定缺口

2026-10-23 的实际查询：

```sh
gh api repos/clydian/same-page/branches/main/protection
gh api repos/clydian/same-page/branches/main/protection/required_status_checks
gh api repos/clydian/same-page/rulesets
```

结果：main 已开启管理员约束、审查过期处理、conversation resolution，禁止 force push/删除；但 required status checks 独立端点返回 HTTP 404，错误明确为 `Required status checks not enabled`；rulesets 为 `[]`。

因此，[workflow 中的严格 verify](https://github.com/clydian/same-page/blob/0db9a6fe9100f45120c4e837525fc721cc3dcdb0/.github/workflows/ci.yml#L275) 保护的是本次流水线及后续部署，**没有成为 GitHub 强制的 main 合并条件**。仓库文档称其为 required check，与实际配置有偏差。

建议要求 GitHub Actions 来源的 `verify` 成功，开启 strict/up-to-date，并保留管理员约束；并行开发时串行完成合并。实际配置前确认最新 main 的核心门禁已恢复，避免把已知失效测试永久固化为门禁。严格检查要求 PR 在最新 base 上验证，可消除“旧 base 绿灯就合并”的一个主要来源。[GitHub 分支保护说明](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)

当前仓库为个人拥有的公开仓库；官方 Merge Queue 的可用范围是组织拥有的公开仓库或 Enterprise Cloud 组织私库，因此不要把立即启用 queue 当成本仓库现成可用的方案。将来资格变化后再考虑，并同时增加 `merge_group` 触发与范围选择支持。[GitHub Merge Queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)

## 2. 历史数据支持什么结论

### 结果总览

| 事件 | 成功，按最新 attempt | 失败，按最新 attempt | 取消 | 未取消运行的最终失败比例 |
| --- | ---: | ---: | ---: | ---: |
| pull_request | 120 | 44 | 51 | 44/164 = 26.8% |
| main push | 61 | 18 | 6 | 18/79 = 22.8% |
| 合计 | 181 | 62 | 57 | 62/243 = 25.5% |

8 个运行存在第二次 attempt：7 个从首次失败变为成功，1 个仍失败。把那 7 个首次失败补回后，未取消样本首轮失败为 **69/243 = 28.4%**（PR 48/164，push 21/79）。这说明只看最终绿灯会低估失败负担，不能据此断言全部失败属于测试误报。

GitHub 重跑保留原 `GITHUB_SHA/GITHUB_REF`，因此这 7 个样本确认了“提交不变也会出现不同结果”；环境、外部状态、测试竞态与产品竞态仍需分别调查。[GitHub 重跑语义](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs)

### 失败集中在浏览器层

以下按最新 attempt 统计，去掉连带失败的 `verify`；同一 run 可出现多个失败 job。

| Job 家族 | 失败 job 数 | 涉及不同 run 数 |
| --- | ---: | ---: |
| smoke | 45 | 38 |
| visual | 14 | 12 |
| platform | 12 | 12 |
| checks | 4 | 4 |
| build | 2 | 2 |
| deploy | 2 | 2 |

62 个最终失败运行中，56 个有浏览器家族失败；79 个原发失败 job 中有 71 个属于这些家族。应先处理浏览器测试与产品异步接缝，进一步微调 lint/npm 缓存不是当前可靠性的主要抓手。

### 不能把真实缺陷删成绿灯

- [main run 38921112699](https://github.com/clydian/same-page/actions/runs/38921112699) 与 [38921951350](https://github.com/clydian/same-page/actions/runs/38921951350) 的 build/typecheck 都报 `musicxml-player.tsx(17,39): TS2304 Cannot find name 'view'`。这是确定的代码错误，保留编译门禁。
- [#560 的首轮 PR CI](https://github.com/clydian/same-page/actions/runs/39876892170) 的两处测试还在寻找已移除菜单项。这类失败应同步更新产品契约断言，不能归咎共享 runner。
- [run 39762082391](https://github.com/clydian/same-page/actions/runs/39762082391/job/119768533968) 浏览器安装步骤超时；当前已改固定 digest 的浏览器镜像，应保留这项修复，不重复建议逐 job 安装。
- [run 39784275733 第二次 attempt](https://github.com/clydian/same-page/actions/runs/39784275733/attempts/2) 在 deploy 报 Git dubious ownership，而首次失败在 Worker 测试。当前已有精确 safe.directory 修复；不能把两次不同失败签名视为同一问题。
- [端口所有权调查](../verification/test-server-port-ownership.md) 已经给出内部端口释放窗口的受控复现和修复，不能再笼统称其为 GitHub 端口随机故障。

### #560 不是已证明的 same-tree flake

| 项目 | PR 最后绿灯 | main 合并后 |
| --- | --- | --- |
| CI run | [39878287849](https://github.com/clydian/same-page/actions/runs/39878287849) | [39892697925](https://github.com/clydian/same-page/actions/runs/39892697925) |
| 实际 checkout SHA | `9ded5807f9e412117bd7a9d90efe7a847f1232bf` | `0db9a6fe9100f45120c4e837525fc721cc3dcdb0` |
| Git tree | `e2a85538f220582098766dee15c2ec48032093bc` | `bc2c5dac4ef70a2baa5e681494eb620d9d67c356` |
| base/parent | `c015021`，#558 后 | `a02e980`，已包含 #555 |
| scope 输出 | 相同 8 个修改文件 | 相同 8 个修改文件 |

PR 已经验证模拟合并结果，并非只测 feature branch；但该模拟合并的 base 比真正合并时旧。两次 Git tree 不同，不能用本例单独证明“同样代码跑两次随机红绿”。这也不能反向证明 #555 导致 WebKit 故障，只能证明集成状态发生了变化。[PR workflow 事件语义](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request)

合并后失败证据为 WebKit `manual reconnect recovery` 超时。观察器记录恢复页最后一次 `update()` 调用后没有 resolved/rejected；但没有记录恢复页 status/button 及完整请求状态，浏览器为何没有恢复仍未独立复现。确定的代码缺口是 [recovery-page.ts:23](https://github.com/clydian/same-page/blob/0db9a6fe9100f45120c4e837525fc721cc3dcdb0/service-worker/recovery-page.ts#L23) 在等待 `registration.update()` 之后才创建 deadline，这段等待没有上界。

这比此前对话中“最可能 WebKit 挂起”的判断更完整：**等待窗口确定存在，内部挂起机制未定；base 变化也必须纳入调查**。

## 3. 应优先处理的热点

| 场景 | 历史证据 | 建议 |
| --- | --- | --- |
| `file-touch-links.test.mjs` | 最新 attempt 的 5 个失败运行，加上 4 个后来重跑成功的首次失败；既有 Ctrl/Meta 新窗口事件超时，也有后段 PDF canvas 不可见 | 拆开链接/原生触摸、新窗口导航、PDF 内容、本机副本入口。浏览器原生修饰键只验证应用没拦截及目的地；PDF/离线接缝由独立场景验证。不要继续在同一条长链上追加等待 |
| `preview-notes-smoke.test.mjs` | 最新 attempt 中 9 个失败运行；存在 WebKit 页面错误中 `Fetch API ... due to access control checks`，请求来自同源 loopback PDF/目录 | 保留“体验笔记不能写入云端”和身份隔离。将 PDF/XML/音频入口分离，定位导航时请求取消与未处理拒绝的关系；不能因出现该错误字符串就假定真实跨域配置错误 |
| `admin-workbench.test.mjs` / `musicxml-startup.test.mjs` | 分别涉及 4/3 个最终失败运行；近期失败有 `/api/client-release` 或附件目录页面错误，主要业务断言已经执行到末尾 | 区分业务状态断言、后台请求生命周期与全局 error 收集。若是应用未处理 rejection，应修应用；若是已明确预期的取消，应在窄作用域验证取消与不更新过时页面。不要全局忽略 TypeError、CORS 或所有 pageerror |
| PWA 更新/恢复脚本 | 12 个最终失败运行，另有重跑成功的初次失败；既有旧 heading、更新按钮未启用，也有 SW registration 缺失及恢复超时 | 分离独立风险场景，统一有界协议等待、阶段证据和单场景运行入口；保留双引擎更新安全保障 |
| `responsive-navigation.test.mjs` | 4 个最终失败运行涉及 footer/keyboard/direct privacy；部分为等待 `/drives` 导航超时 | 分离键盘可达与认证/启动导航；用真正 route readiness 验证，避免外观场景承担整条启动流程 |

例：[文件链接重跑前失败](https://github.com/clydian/same-page/actions/runs/39339439020/attempts/1)、[预览笔记失败](https://github.com/clydian/same-page/actions/runs/39003425626/job/117311093130)、[后台页面错误](https://github.com/clydian/same-page/actions/runs/39803484169/job/119911370693)、[XML 启动页面错误](https://github.com/clydian/same-page/actions/runs/39802500971/job/119907593404)。这些是失败签名和调查方向，不是全部根因已确认；部分测试在窗口内已多次修改，实施时应先对照最新代码。

## 4. 哪些测试可以彻底删除

### 第一批：已退役包之间的历史差分证明

当前 player 是 workspace `0.1.19-samepage.12`，alphatab 依赖 `1.8.4-samepage.18`。以下测试却固定比较更早版本，不驱动当前代码路径：

| 删除候选 | 现在实际验证的内容 | 应保留的替代保障 |
| --- | --- | --- |
| `scripts/player-practice-artifact.test.js` | player 0.1.19 → samepage.1 的固定字节差分 | 当前 player session/practice 行为 |
| `scripts/source-directions-artifact.test.js` | player .2 → .3，native .4 的固定差分/身份 | 当前方向、时序、JSON/MIDI 行为 |
| `scripts/sun-playback-artifact.test.js` | player .3 → .4，native .5 的固定运行模块差分 | 当前角色映射、播放与音频取消行为 |
| `scripts/slur-placement-artifact.test.js` | player .4 → .5，native .6 的固定差分 | 当前 slur 端点、布局、JSON 行为 |
| `scripts/tenuto-placement-artifact.test.js` | player .5 → .6，native .7 的固定差分 | 当前 tenuto 方向/摆放回归 |

建议删除这 5 个文件中的历史差分测试，保留历史 SHA/差分报告作为发布记录。若其中 peer/源码/MPL 责任尚无通用当前版本检查，先合并为**一份跟随当前 lockfile/workspace 的检查**，不要继续按历史版本复制测试。

本地验证命令如下，9 项全过，耗时约 1 秒。因此这一批是降低维护与认知成本，不是本次浏览器失败的主因，也不承诺显著提速。

```sh
npx vitest run --config vitest.node.config.ts \
  scripts/player-practice-artifact.test.js \
  scripts/source-directions-artifact.test.js \
  scripts/sun-playback-artifact.test.js \
  scripts/slur-placement-artifact.test.js \
  scripts/tenuto-placement-artifact.test.js
```

不要按 `artifact` 文件名一刀切。`scripts/native-player-artifact.test.js` 实际执行当前安装包；`scripts/release-artifact.test.js` 防止发布错误 SHA 或被修改的构建包，两者应保留。历史 vendor 包/已发布源码归档是否删除是另外的引用与保留决策，不在测试清理时顺手删除。

### 第二批：删除无效干预与重复断言

- [loading-stability:65](https://github.com/clydian/same-page/blob/0db9a6fe9100f45120c4e837525fc721cc3dcdb0/browser-tests/loading-stability.test.mjs#L65) abort 已内联 attachment-dialog 的旧 chunk，未要求路由被命中；这可能始终只是正常打开表单。删除这个无效故障注入；若普通表单入口有独立保障，也删去重复流程。后面真实 lazy chunk 的 hold/release 有命中信号，应保留。
- 菜单条目全集、“旧条目不存在”等组合断言收敛到组件 contract；浏览器保留实际导航目的地、焦点恢复、键盘操作。当前 personal-menu 单测并未完整承担所有条目组合，需先确认/补齐合适 seam，再删浏览器重复。
- PWA 脚本中的主页按钮总数、关于页具体布局等移出更新安全 suite。离线静态回退和动画按需缓存策略有独立意义，保留到对应能力测试；营销展示不应先于安全交接成为失败点。

### 第三批：删除重复运行量，保留边界

[verify-shell-retention:131](https://github.com/clydian/same-page/blob/0db9a6fe9100f45120c4e837525fc721cc3dcdb0/scripts/verify-shell-retention.mjs#L131) 每引擎 20 次候选替换，再做 20 次完整激活；低层 shell-runtime 已有重复回收策略验证。普通门禁可收敛为跨过 current/rollback/candidate 数量和回收时间边界的最小次数，预计 3–4 次一组；具体数量由状态边界决定。BFCache、第二轮否决、真实 SW 激活和草稿保留继续保留。40 次压力循环从普通门禁删除，需要时运行独立压力实验。

这部分节省尚未测量，不能把循环次数减少比例当作全 CI 提速比例。

## 5. 应保留且稳定下来的风险合同

Same Page 已在使用，数据安全与已部署客户端兼容优先于测试数量。以下每项都需要独立、可定位的门禁：

| 风险 | 主要责任层 | 必需的浏览器接缝 |
| --- | --- | --- |
| 本地草稿、outbox、确认丢失、OCC、身份切换 | 纯状态机/组件 + Worker 集成 | 真实 IndexedDB/Web Locks、重启与在途操作的少量代表路径 |
| 权限撤销、受托范围、成员/用户生命周期 | 真实 Worker/D1 | UI 与实际服务端拒绝的一条主链，不能只检查按钮隐藏 |
| 迁移与旧客户端兼容 | 真实迁移、兼容合同 | stable/beta 实际存储 probe 往返 |
| PDF 可读、笔记几何、关键触控与导出 | 纯几何/导出 + 浏览器 | 真实 PDF.js/Canvas、实际输入与结果内容；不能只断言 HTTP 200 |
| 真正的离线副本 | 产品下载/校验 + 持久化 | 后端停止、浏览器关闭重开后仍可看到正确谱面 |
| 安全更新与恢复 | 状态机/协议 + SW 集成 | 多窗忙碌否决、完整壳、失败重试、缓存边界；两引擎 |
| 发布身份与顺序 | 制品/admission/部署集成 | 已验证原字节、SHA、权限/锁及线上身份读回 |

不建议整体移除 WebKit。项目有已复现的 WebKit IndexedDB 缺陷记录，jsdom 无法保护这一类平台接缝，见 [WebKit 同步扫描诊断](../verification/webkit-sync-diagnostics.md)。但普通菜单组合、后端权限排列不需要每个都在两引擎中完整重演。

## 6. 建议的目标流水线

沿用当前 Node/Vitest/Playwright library，不以更换整个 runner 为前提；Node test 文件不自动接受 Playwright Test 的 retries/trace 配置。测试应独立并围绕可观察行为，等待产品状态而非任意时间，这与官方建议一致。[Playwright Best Practices](https://playwright.dev/docs/best-practices)

| 层 | 触发 | 内容 | 失败处理 |
| --- | --- | --- | --- |
| 快速合同 | 每个相关 PR，未知范围保守全套 | lint/typecheck、领域规则、组件、真实 Worker/权限/迁移（按风险选择） | 阻断合并 |
| 核心浏览器集成 | 每个相关 PR + 实际 main 产物 | 少量核心旅程；SW/IDB/Canvas/touch 等引擎差异保留 Chromium/WebKit；普通展示用最低必要矩阵 | 阻断合并/发布；高风险失败先修复 |
| 扩展兼容与压力 | 对应模块修改时；独立按需或将来另行安排周期运行 | 更多视口、长时间/大量更新、全部格式及资源压力矩阵 | 对高风险变更仍可升级为必需；低风险实验不阻断无关 PR，但有明确处理责任 |
| 发布准入 | main，沿用当前受控发布冻结与授权 | 已验证封存字节、实际稳定目标兼容、迁移、锁和身份 | 阻断发布，不自动退回旧兼容假设 |

不建议现在取消 main 检查或直接发布 PR 构建包。squash 改变 SHA，前端 release URL/身份与封存校验依赖实际 SHA；PR 验证包不自动等同于实际 main 发布字节。只有将来建立可验证的等价关系才考虑更进一步复用。

范围选择保留当前“未知路径全套”的兜底，逐步增加少量可解释风险组：身份/权限、存储同步、阅读器输入、更新发布、纯展示。现在 [ci-scope:130](https://github.com/clydian/same-page/blob/0db9a6fe9100f45120c4e837525fc721cc3dcdb0/scripts/ci-scope.mjs#L130) 几乎所有客户端产品变更都会跑全部 visual/smoke/performance，仅 3 个展示叶子可收窄。优先对消费者明确的叶子做审计，不建设庞大的自动依赖选择引擎，也不让数据/迁移检查只在合并后出现。

## 7. 可靠性与成本，分别治理

### 可靠性

1. 失败报告带 source SHA、Git tree/base、scope、Node/npm/browser/runner 版本、attempt、测试阶段和失败签名。
2. 复用已有 `withBrowserEvidence`：76 个浏览器测试文件中仅 11 个静态导入该工具（不等于其他文件完全没有自定义证据）。补齐高频失败场景的脱敏 failure-only trace；PWA 还需页面 status/button、当前 build、SW 请求 pending/完成/失败与当前阶段。
3. 测试必须支持单 engine、单 scenario 运行。把 shell-lifecycle 长链拆成迁移交错、路由合同、损坏壳恢复、quota 等；准备可共享，状态不能串扰。
4. 产品恢复页的整个操作设置有界等待，超时恢复可操作状态，并隔离迟到结果。`Promise.race` 本身不会取消浏览器 `update()`；新旧重试意图、等待 worker 的激活和跳转必须防止互相污染，保留跨窗否决。
5. 默认不自动重试业务断言。诊断重跑可以做，但首次失败单独计数；明确 setup/下载错误可有限重试，保留原错误。不能把任意 TypeError/Timeout 都当基础设施错误。
6. 对确定无独立价值的测试直接删除；有独立价值的 flaky 修应用或 fixture。低风险测试临时退出硬门禁必须有负责人、替代保障和处理期限，不能成为永久垃圾箱；数据/权限/更新保障不靠隔离放行。

已有十连跑工作流保留为快速筛查，不新增自动运行。若真实独立失败率为 1%，十次全绿的概率仍约 90.4%，十连绿不能证明稳定。优先用已知失败签名做受控复现，再用实际首轮运行趋势评价。

### 成本与关键路径

额外抽查最近 10 个成功、耗时超过 2 分钟的 main push；按 workflow 开始至 verify 完成测量，中位数 **690 秒（11 分 30 秒）**，其中一个仅跑 visual。9/10 的最后完成验证 job 是 `smoke (3)`。

这不是 10 份完全同 scope 的性能基准。可确认的是当前 [smoke 矩阵](https://github.com/clydian/same-page/blob/0db9a6fe9100f45120c4e837525fc721cc3dcdb0/.github/workflows/ci.yml#L227) 有 3 个分片、`max-parallel: 2`，第三片天然在第二波启动。优先减少分片内重复 fixture/长旅程；若 runner 配额和预算允许，再单变量试验并行 3，比较等待时间、总 runner 分钟与失败率。不能在未测量前断言增加并发一定更快、更省或更稳定。

PWA 脚本另做两次完整合成 build，且营销动画先于更新安全检查；可用最小真实 SW fixture 承担多数协议排列，保留一条当前真实 UI 与 SW 集成。合成版本必须继续与生产封存字节隔离。

当前已移除的 200ms SLA、浏览器惯性曲线、固定装饰间距等，不应在这次建议中当成仍存在的问题。之前的多轮精简有真实收益；本轮应补持续治理，避免每次新增场景又默认加入全部硬门禁。

## 8. 推荐实施顺序与验收

| 批次 | 具体工作 | 验收标准 |
| --- | --- | --- |
| A：准入与基线 | 稳定最新 main 的核心 verify，启用 GitHub required verify + strict；保存首次结果/版本身份/失败签名 | 旧 base、失败、取消、意外 skipped 均不能合并；重跑不抹去首次失败记录 |
| B：热点修复 | 独立复现 recovery 无界等待、拆 file-touch/PWA/preview 长链、诊断预期取消与未处理 rejection | 每个原始失败签名有能变红的独立反馈环；产品错误修复后变绿，fixture 错误有机制证据 |
| C：明确删减 | 删除 5 个历史差分测试、无效 chunk 干预、重复菜单组合，缩减 retention 循环 | 每个删除项记录保留风险及责任位置；代表性错误注入仍会被对应测试拦住 |
| D：风险与成本 | 逐模块收窄 scope/引擎/视口矩阵，拆扩展压力；测量 smoke 并发是否值得调整 | 关注首轮非产品失败率、诊断可归因率、verify p50/p95、runner 分钟，按同 scope 比较 |

建议首个治理窗口看两周趋势：未知原因失败逐步清零；同签名反复重跑必须进入修复；无代码变化的误报目标低于 1%，核心数据/更新场景保持零已知未处理 flaky。1% 是治理目标，不是当前已达到或用十次实验能证明的指标。不要以减少用例数或覆盖率作为完成标准。

本轮没有修改 schema/API/本地存储，无需迁移。后续任何测试重构都继续遵守 AGENTS 的已部署客户端与用户数据保护要求；发布开关和受控桥接不随 CI 清理自动开启。

## 附录：可复核的数据入口

```sh
# 三页各 100 个 run；run 返回最新 attempt，因此须另外查历史 attempt。
gh api 'repos/clydian/same-page/actions/workflows/ci.yml/runs?per_page=100&page=1'
gh api 'repos/clydian/same-page/actions/workflows/ci.yml/runs?per_page=100&page=2'
gh api 'repos/clydian/same-page/actions/workflows/ci.yml/runs?per_page=100&page=3'
gh api 'repos/clydian/same-page/actions/runs/RUN_ID/jobs?per_page=100'
gh api 'repos/clydian/same-page/actions/runs/RUN_ID/attempts/1/jobs?per_page=100'
gh api repos/clydian/same-page/actions/jobs/JOB_ID/logs

# 已关闭 PR 的 merge ref 可能消失，使用 checkout 日志里保存的 commit SHA。
gh api repos/clydian/same-page/commits/9ded5807f9e412117bd7a9d90efe7a847f1232bf
gh api repos/clydian/same-page/commits/0db9a6fe9100f45120c4e837525fc721cc3dcdb0
```

采样列表会随新运行移动，应以上述日期窗口与下面的固定 run ID 为本次快照。原始 API/log 临时数据位于本机 `/tmp/same-page-ci-audit/`；报告只保留合成测试与 CI 元数据，不纳入会话凭据或用户内容。

### 全部重跑样本

| Run | 事件 | 第一次失败 | 第二次结果 |
| --- | --- | --- | --- |
| [39784275733](https://github.com/clydian/same-page/actions/runs/39784275733) | push | Worker annotations-flow 超时 | deploy Git ownership 失败，换了失败点 |
| [39636304054](https://github.com/clydian/same-page/actions/runs/39636304054) | PR | file-touch-links PDF canvas 不可见 | 成功 |
| [39517963021](https://github.com/clydian/same-page/actions/runs/39517963021) | PR | file-touch-links + PWA | 成功 |
| [39460803567](https://github.com/clydian/same-page/actions/runs/39460803567) | push | file-touch-links | 成功 |
| [39339439020](https://github.com/clydian/same-page/actions/runs/39339439020) | PR | file-touch-links 新页面事件超时 | 成功 |
| [39241341404](https://github.com/clydian/same-page/actions/runs/39241341404) | push | pdf-codecs reader sheet 不可见 | 成功 |
| [39057131324](https://github.com/clydian/same-page/actions/runs/39057131324) | PR | smoke 步骤超时 | 成功 |
| [38926336100](https://github.com/clydian/same-page/actions/runs/38926336100) | push | MusicXML playback + preview notes | 成功 |

