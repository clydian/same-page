# #539 本地实现与验收记录

2026-10-22。分支 `codex/release-channels-539`，比较基线
`685a0eaf0b95a05f90ea38e927889033afce69ab`。仅本地工程实现与隔离测试；
没有部署、生产迁移、创建 bucket、修改生产指针或授权生产发布人员。

实现决策见 [ADR-0021](../adr/0021-release-channels.md)，首次启用步骤见
[发布 runbook](../operations/production-release.md)。默认构建和 runtime flag 均关闭通道，
桥接完成并另行授权前不显示选择器，也不在旧页面上查询通道 API。

## 产物与数据回切

`verify-release-storage.mjs` 逐字节读取两个探针，校验摘要后在 Chromium/WebKit
全新临时持久 profile 运行实际 SamePageDatabase 的
`stable → candidate → stable → candidate`。本地已用基线源码快照和当前源码构建
**不同的两个探针**通过回切，包含 Blob／快照、继续编辑、真实草稿与队列写入、
协议解析与 push/pull 合并、已尝试 opId、冲突及归属隔离。

本地快照验证不冒充线上当前 stable 产物验收。正式 uploader 必须从 R2 下载当前 stable
封存的原始探针，与候选原始探针运行同一矩阵；报告绑定双方 ID 和探针摘要，
私有封存对象和 D1 记录共同参与 beta 准入、stable 提升检查。存储契约不相等直接拒绝。
探针与报告不在公开前端清单内。

WebKit ephemeral context 的原生 Blob 首写错误已通过对照定位为运行模式限制：
全新临时 persistent context 的原生 IDB 和产品数据库 Blob 均通过。
此结论不替代真实 Safari/iOS 验收。

## 浏览器与服务端证据

- `verify-release-channels.mjs`：Chromium 151.0.7922.34 / WebKit 26.5 使用实际生产
  SW 模块，通过冷启动 stable、A/B 回切、忙碌窗口否决、过时候选拒绝、无窗口自动激活
  不取得错误显示许可；另通过 Cookie 回 stable 且稳定缓存缺失时的恢复、忙碌窗口阻止恢复、
  保存后再次重试成功。结果为 `artifacts/verification/release-channels.json`。
- `verify-shell-lifecycle.mjs`：Chromium 自动／手动 A/B/C、WebKit 手动 A/B/C，
  完整壳校验和真实配额不足恢复通过。
- `verify-shell-retention.mjs`：双引擎各二十次候选替换及二十次激活有界保留；草稿保留。
  Chromium 观察到真实 BFCache 恢复；WebKit 仅观察到普通返回，未声称其 BFCache 通过。
- `verify-update-diagnostics.mjs`：双引擎旧壳旁准备候选、旧壳绕过、失败重试、
  阻塞数据库诊断、草稿保留且不意外创建业务库通过。
- Worker 集成验证覆盖默认 stable、封存资源与缓存边界、未知 API、Cookie 权威、
  独立授权、精确 CAS、证明缺失拒绝、单次审计与幂等、撤销授权后拒绝，以及 R2 条件首写。
- Standards 与 Spec 独立复审发现的契约覆盖、原子回执、Cookie 过期、产物证明、
  发布浏览器环境与恢复页交接问题均已修复，复审未发现仍存的确定问题。

## 回归执行说明

`VITEST_MAX_WORKERS=4 npm run check` 中，CI 范围判断、lint、typecheck、
66 个 node 单测文件（295 项）、139 个客户端单测文件（1171 项）、
Worker unit（8 项）和 integration（181 项）通过；后续新增的 picker 关闭开关测试、
真实鉴权提升 endpoint 测试亦分别通过。最终配置的构建与迁移测试通过。

视觉全套初轮执行了 205 项，含本轮修复前的通道查询、预览身份头失败，以及导航超时／
配置重载干扰；因此该次 `check` 本身为失败，不能描述成一次全绿。
固定最终配置后，所有失败所在场景已分别重跑通过：practice-focus、reader-conflicts、
reader-presentation、reader-settlement 的双引擎 pinch，以及 uiux-return（WebKit 又单独重跑全部场景）。
未放宽业务断言或超时，也未删除失败用例。

默认构建的完整 smoke 通过 63 项；默认与启用通道构建的加载性能预算均通过。
`SAME_PAGE_RELEASE_CHANNELS=1 npm run build` 最终生成 128 个唯一壳资源，
6,921,215 bytes，小于 7 MiB 门槛。启用产物的代表性真实浏览器检查通过：
Chromium 离线重启／撤销权限、实际 D1/R2 内容与 IndexedDB 重启恢复、
WebKit API 中断新页面／撤销权限。WebKit 首轮有一次 SW ready 等待超时，
诊断复跑及未修改原用例的单独重跑均通过，未放宽断言。

CI 通道开关只作用于正式 build；dev 视觉与合成 PWA build 保持各自原来条件。
smoke/performance 仍下载并校验同一份正式 artifact。隔离 preview 自动在自己的
临时 D1/R2 目录准备同 SHA 的 bridge 控制元数据，前缀资源仍是原始 ASSETS 字节，
真实 SW 继续校验它们。这不是生产 R2 托管全链验收；正式发布桶和路由仍需受控上线验证。
通用视觉夹具明确响应对应构建身份的 release GET，不把新控制请求当作未知业务请求。
CI 范围判断 21 项与视觉夹具测试在补修后通过。

## 尚待受控上线验收

真实 iOS PWA、Android TWA 的启动／离线 Blob／回切／旧壳行为，以及生产 IAM、CDN、
原始 legacy 资源归档、首次 bridge 和当前线上 stable 原始产物矩阵，必须在另行授权的
发布过程中留证。它们不由本地 Chromium/WebKit 仿真替代。本 issue 在这部分完成前保持打开。
