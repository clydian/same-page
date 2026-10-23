# Playwright / Linux WebKit 更新（#564）

本次将 `@playwright/test` 精确固定为 1.64.1，并同步更新 `ci.yml`、
`browser-stability.yml`、`bootstrap-release-channels.yml` 的全部七处预装镜像：

```
mcr.microsoft.com/playwright:v1.64.1-noble@sha256:47b510dd9230bf0b9bfc9b20102241e577ea7a99334ab4c3ca19f19770e9b8ea
```

[#564](https://github.com/itscly2026/same-page/issues/564) 的原生 Linux 复现中，
离线后的更新请求先触发 libsoup session feature 对象断言，再出现 Internal error 和
Service Worker 注册查询为空。相同失败在删除历史迁移链后仍能复现。
[上游 Playwright #42803](https://github.com/microsoft/playwright/issues/42803) 与
[WebKit 修复 #74619](https://github.com/WebKit/WebKit/pull/74619) 将同类对象生命周期缺陷
关联到 libsoup 3.6.5；3.6.6 包含修复，Playwright 1.64 开始携带更新库。

先前仅换库的对照中，旧库第 5 轮失败，3.6.6 连续 50 轮通过，恢复旧库后 20 轮也通过。
因此升级针对已确认存在的上游缺陷，不把单次绿灯或这些样本当作所有偶发问题均已消失的证明。

`.github/scripts/verify-browsers.mjs` 继续核对 SDK、锁文件与镜像版本一致，并读取 Linux
WebKit 随附的 libsoup 二进制版本，拒绝低于 3.6.6 的库，再实际启动 Chromium/WebKit。
这样 CI 会检查镜像里的实际库，而不只依赖版本标签。常规 CI 不安装替换库或使用 LD_PRELOAD。

验证以 PR 的完整 Linux CI 为准：lint/类型检查、播放器与客户端单测、Worker 与迁移、
四个界面分片、生产构建、双引擎完整 PWA、加载性能、三个真实存储 smoke 分片及最终 verify。
每个浏览器容器首先执行上述版本检查。bootstrap 与稳定性工作流使用同一镜像和检查脚本；
验证不运行生产通道初始化或发布操作。

业务 schema、API、本机存储、已部署客户端协议没有变化，无需数据迁移。
完整 manifest、更新身份、跨窗否决、未同步草稿、迁移兼容的原断言与期限保留。
