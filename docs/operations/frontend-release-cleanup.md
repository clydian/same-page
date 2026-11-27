# #609 一次性前端发布清理

本批只允许清理 2026-11-27 14:27 UTC 盘点中的 51 个完整 SHA，名单随代码审查固定。盘点时通道 revision 为 96，候选共 15,423 个对象、2,428,556,713 字节。实际删除集合以新的预览为准。[#609 授权批次](../../scripts/frontend-cleanup-609.mjs)

工作流只有 GitHub Actions 的手动入口，使用 `same-page-production` 锁与正常发布互斥。清理范围限私有桶 `same-page-frontend-releases` 的候选版本对象。保留 `compatibility/`、`legacy/`、`legacy-claims/`、未知前缀、D1 和分发配置。#607 的旧运行与预览属于之前的授权，禁止重新运行。

## 1. 运维准备

合并后，从仓库的 [Frontend release cleanup #609](https://github.com/clydian/same-page/actions/workflows/frontend-cleanup.yml) 进入 `Run workflow`，选择 `main`。使用既有 production environment 及其审批流程。工作流 GitHub token 需要 `contents: read`、`actions: read`、`deployments: read`。既有 Cloudflare 凭据需要读取 D1 与列出、读取和删除该桶的对象。

核对 11 月 26 日锚点以来的运维与事故记录，确认没有通过其他入口重新准入历史 Beta 或恢复 D1 到旧快照。预览和 apply 期间须暂停控制台提升、手工准入、手工 R2 写入及其他绕过发布锁的操作。R2 批量删除在发送前复查对象身份，发布锁和上述操作约束覆盖复查与删除之间的间隔。

## 2. 预览和审查

1. 选择 `mode=preview`，其余输入留空。本步骤只读。下载成功运行的 `frontend-cleanup-plan-<run>-<attempt>`，打开 `report.md` 和 `plan.json`。
2. 核对当前 Stable、Beta、revision 和最近两次不同 SHA 的 Beta 准入。当前指针、最近两次已证实准入、D1 `release_promotions` 的两端和快照保护名单均受保护。当前、最近两次准入及仍有资源的历史 Stable 校验完整封存文件的哈希、大小与分发元数据。核对预览单列的缺失历史 Stable 与快照一致。三个原本没有对象的旧 Stable 的缺失不计入本批回收。
3. 核对 `decisions`、各 SHA 的对象数和总字节。只有 `disposition=delete` 的精确键会进入 apply，每条包括 ETag、字节数、最后修改时间。候选总数与字节均以获准盘点为上限。审阅所有跳过项及其理由。锚点后的写入、登记未就绪、无法排除重新准入的候选保留。
4. 记下成功预览 run ID 和报告中的完整 `plan.json SHA256`，按该精确清单审阅本批的最终范围。

本批以盘点时点前 24 小时作为最短缓冲。GitHub Actions 的两次实际 Beta 准入在 11 月 26 日 00:58 和 04:22 UTC 成功，均早于 14:27 UTC 截止点。脚本把准入步骤与锁内建立的 GitHub production-release 记录匹配到具体 attempt。只有严格早于第一锚点的 Git 祖先、锚点之后没有生产发布记录的名单内 SHA 才可继续检查。D1 `ready` 和 R2 最后修改时间追加保护。`published_at` 只作为登记时间使用。缺少完整审计、D1 通道对不上审计或保护版本校验失败时，运行停止。 [第一次 Beta 准入](https://github.com/clydian/same-page/actions/runs/45731390330) · [第二次 Beta 准入](https://github.com/clydian/same-page/actions/runs/45753709887)

## 3. 执行精确清单

在同一工作流、同一 `main` 源码上选择 `mode=apply`，填入 `preview_run` 和 `plan_sha256`。工作流校验预览来源、成功 attempt、artifact 摘要与清单 SHA256。预览保留 14 天。

每批最多 500 个精确键。删除前重新比对完整库存、两端 Stable 晋升、当前通道、GitHub 准入审计和保留判定所需的 D1 记录。新对象、对象身份或保护状态变化、读取错误均停止。删除后再次检查计划对象已经消失，并校验保留版本完整性。

## 4. 验收和重试

检查 `frontend-cleanup-result-<run>-<attempt>` 内的 `apply-result.json`，确认 `complete=true`。通过两条线上入口分别验证 Stable/Beta 的进入、更新和练习谱播放器。留存预览、人工核对记录和结果 artifact（90 天）。

遇到中断或部分失败，先检查日志和 journal。`pendingBatch` 表示这批结果仍待确认。状态未变时可重试同一个已审阅计划，脚本会跳过已不存在的计划删除对象。通道、库存或源码改变时，重新预览并核对。任何手动补删都超出本入口。R2 删除无法撤销，历史旧页尚未缓存的资源可能无法按原地址加载。

本地用隔离数据验证，生产 apply 仅允许仓库 `main` 的手动工作流运行。

```sh
npx vitest run --config vitest.node.config.ts scripts/frontend-cleanup.test.js
```
