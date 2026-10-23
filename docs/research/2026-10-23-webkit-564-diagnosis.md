# #564：Linux WebKit 离线更新后注册查询为空

## 当前证据

已在原生 GitHub Actions 中重新捕获与 [#564](https://github.com/clydian/same-page/issues/564)
相同的失败，并去掉历史 A/B/C 迁移后再次复现。最强候选是 Playwright 1.62.1
随附 libsoup 3.6.5 的已知 session feature 对象生命周期缺陷。库替换的因果对照结果见下文。

所有实验均为本机合成 origin；没有读取或修改生产业务数据、schema、同步、VPN、
用户浏览器配置或 main 的门禁。诊断分支基于原始失败提交
`1419c24027ab6cd426c6f7421afac91eb19daa29`，没有放宽产品测试断言、期限或添加 CI 重试。

## 原始长链在原生 runner 复现

- [诊断运行 39906988320](https://github.com/clydian/same-page/actions/runs/39906988320)，attempt 1，
  诊断提交 `ae13a6e8aa301177c01297da2df052a1aac2e266`。
- [sample 2 job](https://github.com/clydian/same-page/actions/runs/39906988320/job/120261104366)：
  原始 `npm run test:pwa-update` 通过；额外 lifecycle 第 1 轮通过，第 2 轮严格失败并停止。
- 镜像保持 `mcr.microsoft.com/playwright:v1.62.1-noble@sha256:dcc5531e97840b9b5e794f2814476b21571c5124a3fca2267d73041f56e7580e`；
  Node 24.21.0、WebKit webkit-2336。没有通过新浏览器版本改动第一次复现条件。
- `first-offline-reload` 阶段显示“关于合谱”，controller 仍为 activated，
  `getRegistration()` 返回空、`getRegistrations()` 返回 `[]`。

该次失败的关键时间线（UTC；客户端时区为 Asia/Shanghai，+08:00）：

| UTC | 事件 |
| --- | --- |
| 05:45:33.269 | 离线前 registration、active、controller 均存在 |
| 05:45:33.365–.377 | 离线刷新后 `register('/sw.js')` 调用并正常返回 |
| 05:45:33.397 | 调用原生 `registration.update()` |
| 05:45:33.396–.397 | 网络进程 PID 3193 报 `g_object_ref` 与 `soup_session_feature_request_queued` 断言 |
| 05:45:48.409 | WebKit 原生 `WebLoaderStrategy::internallyFailedLoadTimerFired()` 报内部错误 |
| 05:45:48.414 | 更新 promise 以 `TypeError: Internal error` 拒绝 |
| 05:45:48.501 | 完整 manifest 审计因 registration 为空失败 |

500ms 进程快照里，PID 3193 在断言前后及错误返回前始终存在；该次 cgroup
`oom`、`oom_kill` 始终为 0。因此，本次复现没有证据支持“网络进程已退出”或 OOM。
这不排除存活进程内部会话/IPC 失效，也不能反推最初未采集原生日志的运行。
注册 API 返回空本身不能证明持久化注册数据库已经被删除。

sample 1 更早在“检查更新”按钮持续禁用处失败，未进入 #564 的审计路径。
这个失败单独保留，不能记为 #564 的复现，也未重跑碰绿。

## 去掉迁移后仍能复现

[最小化运行 39907774815](https://github.com/clydian/same-page/actions/runs/39907774815)，
诊断提交 `1029332fd21d8c18f062dc72c1f56883743901f5`，attempt 1。

fresh-current 变体只删除 A/B/C 历史迁移，改为安装单个当前 C；原有 API、Back、
根壳修复、离线刷新、完整 manifest/身份审计和重连断言保留。该变体只选择 WebKit，
不用 Chromium 的执行上下文辅助。

前 8 轮通过；第 9 轮在首次离线刷新复现相同 registration 为空和 libsoup 断言。
这证明历史迁移不是必要条件；尚未证明剩余每个步骤都是必要条件。
生成变体仍保留原测试的成功文案，报告应以生成脚本的实际差异判断范围，不能将其
成功日志中的 “A/B/C migration” 当作迁移验收。

同一运行的纯 SW 对照（online / response.destroy / refused × 显式 update 有无，
每组 50 轮，共 300 个独立 context/origin）即时注册审计全部通过。
这组没有强制每个用例等待原始 15–22 秒窗口，不能据此排除所有延迟故障。
另外 macOS 与 Linux PRoot 的六项延长观察对照各等待 23 秒，均保留注册；
Linux PRoot 的 10 轮重建长链也通过。PRoot 结果不替代原生 runner 证据。

## 与上游缺陷的匹配

[Playwright #42803](https://github.com/microsoft/playwright/issues/42803) 记录
同一 webkit-2336 / Playwright 1.62.1 随附 libsoup 3.6.5。
该版本异步读取失败时可能重复结束队列项，从而重复释放 session feature；下一个请求
遍历过期对象，出现与本次一致的 GLib/libsoup 断言，之后行为可能包括内部错误或崩溃。

[WebKit 已合并的修复 #74619](https://github.com/WebKit/WebKit/pull/74619) 更新至
libsoup 3.6.6，明确关联此缺陷与 libsoup 修复 `794e089`、`0f424631`。
[GNOME 的原始修复](https://github.com/GNOME/libsoup/commit/794e089abe8a58486970a4646aae99b2f03b808e)
为已完成的队列项增加状态检查，防止再次结束。
Playwright 维护者在 #42803 注明修复会包含于 1.64；
[1.64.0 已正式发布](https://github.com/microsoft/playwright/releases/tag/v1.64.0)。

当前优先级：libsoup 3.6.5 已知缺陷；与该库无关的 WebKit SW 连接缺陷；
夹具时序或观察器触发的其他缺陷。相同报错只构成强匹配；库对照用来继续检验因果关系。

## 库替换对照

[对照运行 39908210739](https://github.com/clydian/same-page/actions/runs/39908210739)，
提交 `5c9088266cc5305bfbc2836b4f02e0fe3f7f3ca5`，attempt 1。
同一 runner、镜像、构建、fresh-current 反馈环，按顺序仅切换加载的 libsoup 库：

| 条件 | 实测结果 |
| --- | --- |
| 随附 libsoup 3.6.5 | 前 4 轮通过，第 5 轮同签名失败并停止该组 |
| 单独编译的 libsoup 3.6.6，经 LD_PRELOAD 加载 | 50/50 通过；日志未出现该 libsoup 断言或 Internal error |
| 切回随附 3.6.5 | 20/20 通过，未再次捕获失败 |

实际映射已由 `/proc/<WPENetworkProcess>/maps` 验证：修复组 50 个网络进程加载固定路径的
3.6.6，原库两组 25 轮中观察到 26 个网络进程加载浏览器随附路径；没有同一个进程同时映射两份库。
源码来自 GNOME 官方 3.6.6 tarball，SHA-256 为
`51ed0ae06f9d5a40f401ff459e2e5f652f9a510b7730e1359ee66d14d4872740`；
编译命令和二进制摘要均保留。三组 OOM 计数始终为 0。

旧库第 5 轮还有进程层信号：同一 MiniBrowser PID 3628 下，网络进程 PID 3639 最后一次
被采样于 05:55:34.077 UTC，新网络进程 PID 3765 于 05:55:34.579 已存在；
浏览器清理直到 05:55:34.637 才开始。因此该次确有清理前的网络进程替换，
能解释为什么旧库两组 25 轮观察到 26 个网络进程。没有捕获旧进程的退出信号，
不能据此单独宣称 SIGSEGV。与第一次存活进程的失败并列保留，不能将所有失败都简化成同一种退出行为。

**可以确认的范围**：本仓库故障发生在 Linux WebKit/libsoup 原生层；旧环境已独立三次复现，
其中两次完全删除迁移链，原生 session feature 断言与已知 3.6.5 缺陷高度吻合。
单独换库的 50 次通过支持修复方向。

**尚未完成的因果闭环**：切回旧库的 20 次也通过；50 次绿灯不能证明偶发问题已根治。
这不是确定性的 A→B→A 复现，也没有本仓库故障的符号化内存分配/释放栈。
精确到“本次就是 794e089 所修的双重 finishing”的归因仍是高置信候选，不能标成已完成修复验收。
原始失败保留为非零结果，所以整个诊断 job 为 failure，不代表修复库组失败。

## 后续修复方向

同步升级 Playwright 依赖与 CI 固定镜像到包含上游修复的版本（至少 1.64），回读实际
libsoup 版本，再用原始完整 PWA 流程、严格 manifest 审计和既有跨窗口/草稿/迁移测试验收。
本轮只定位和取证，没有升级产品依赖、修改测试放行策略、合并或发布。

## 证据位置

可长期保留的合成现场位于 [issue-564-evidence](issue-564-evidence)：
原长链失败、fresh-current 失败、原生错误摘录、进程与 OOM 摘要。
完整产物见上述 Actions 运行；GitHub artifact 保留期为 14 天。
诊断实现位于本分支 `.github/diagnostics/`，反馈环可由相应 workflow 无人值守运行。
