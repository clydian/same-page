# 云盘会话恢复与乐谱加载反馈（#325）

## 范围与证据

原始 iPad PWA 反馈只有 `reader-document / TimeoutError`，不足以确定当时是网络、PDF Worker、文件解析还是本机校验阻塞。此次没有宣称重建了那次现场根因。本地对照已复现顶部刷新无法恢复失败会话，以及 HTTP 200 后本机会话校验异常仍显示连接失败。

回归先覆盖失败行为，再修正：真实 auth client 的顶部刷新、503 后留在原页恢复、本机校验错误、signed-out/local-error/hidden 状态的 online 事件；ReaderSession 的文档未就绪与文档已就绪后本机校验阻塞；PDF Worker 未就绪与文件首字节等待；未知文件总量、共享 lease、销毁后的回调、替换失败后保留原谱面的完成状态；诊断回执丢失和 Worker 回滚组合。

打开进度保持原 PDF.js streaming/Range 路径。`PDFWorker.promise` 完成后才进入文件阶段，`onProgress` 提供字节计数，当前页呈现确认才结束打开。未知总量无百分比，加载 100% 不等于离线副本已完整校验。没有用户存储 schema、乐谱文件、批注或 outbox 的迁移。

## 验证方式

本机使用 Node 24.19.0；分支从 `f1a72a9` 创建，首次提交前更新至 `1988af8`（#324），本次 rebase 更新至 `7cb6311`（#328、#330）。冲突仅涉及离线入口测试的两项 import；保留主线的分阶段等待、慢速本地存储与副本校验门禁回归，以及本 PR 的会话恢复和本机校验回归。rebase 后 lint、typecheck 和客户端全量测试通过；此前 `a7a464a` 的远端 CI 全部通过，新提交结果以 PR 检查为准。

- `npm run lint`、`npm run typecheck`、`npm run test:unit`、`npm run test:worker`、`npm run build`。
- `npm run test:client -- --maxWorkers=2`：更新到 `7cb6311` 后 84 个文件、758 项通过。本机与浏览器/Worker 同时高负载运行时曾出现已有的短等待超时；没有放宽通用测试超时，最终在不并跑这些重任务的条件下复核。
- `visual-report/reader-opening.test.mjs`：真实 HTTP 分块响应暂停在半途，经真实 PDF.js，在 Chromium/WebKit 和 820/320px 窗口验证已知/未知总量、字节数及首屏遮罩退出；输出在 `artifacts/verification/reader-opening/`。
- `visual-report/drive-library-lifecycle.test.mjs`、`visual-report/ui-polish.test.mjs`：直接恢复提示、背景刷新、滚动与搜索保留、重新校验期间文件行稳定。
- `browser-tests/offline-entry-smoke.test.mjs`、`browser-tests/diagnostic-reports.test.mjs`、`browser-tests/pdf-codecs-smoke.test.mjs`：真实本地 Worker/存储、离线重启、权限撤销、丢失回执、CCITT/JPEG2000 与缺失原生 API，合计 10 项通过。

首次全量浏览器运行的 `webkit: continuous pinch at scroll 300 keeps the score point fixed after release` 断言在原始未修改基线 `f1a72a9` 的独立 checkout 同样失败。本卡不通过放宽该断言解决它；随后已更新到新主线的 #324 缩放修复。最终 CI 结果以 PR 的具体提交为准。

## Standards

原审查发现 1 项：报告可能已保存但回执丢失时，后续旧 Worker 的 400 不得触发同 ID 的 payload 改写。现限定只有该报告首次实际发送被明确拒绝才能去掉扩展字段；新增“丢失回执 → 旧 Worker 400 → 恢复回执”测试通过。复审无未解决发现。

## Spec

原审查发现 2 项：Better Auth 内置 online 通知绕过有界恢复；PDF Worker 尚未就绪时过早声明获取文件。现使用公开 OnlineManager 接口统一恢复调度，并显式持有/等待/销毁 PDFWorker；真实 auth client 和 Worker 延迟/取消回归通过。复审无未解决发现。

两轴复审：Standards 0 项未解决，Spec 0 项未解决。

## 发布与真机边界

未合并、未部署。新旧诊断格式和回滚行为见 [运维说明](../operations-diagnostics.md)。桌面 Chromium/WebKit、合成网络与本地 Worker 不能替代真实 iPad Safari/PWA 的弱网、返回重试和后台恢复验收；上线后需对用户相同文件重新采集带阶段与进度的新诊断。
