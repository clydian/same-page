# CI 清理与测试收敛 · #372

基线 `553d7ce`。[失败运行](https://github.com/clydian/same-page/actions/runs/35519848277) 中 checks、visual 成功；outbox WebKit after 钩子删除缓存目录时报 ENOTEMPTY，随后 smoke 超时，部署未执行。

## 根因与修复

原测试按顺序注册 server.close、rm(profile)、context.close。Node 24 最小实验确认：after 按注册顺序运行，rm 抛错后 context.close 不执行。尚未关闭的 WebKit 可能继续写缓存；目录清理竞争与关闭被跳过共同解释日志。没有在 Linux runner 追踪缓存写入者，本地原测试 2/2 通过，不冒称完整复现目录竞争。

现在以一个 after 钩子先关闭 context，再删除 profile，最后关闭 Vite；嵌套 finally 确保前一步抛错不跳过后续清理，并兼顾 listen/mkdtemp/launch 中途失败。保留全部 outbox 数据断言，不扩大 timeout 或增加重试。

## 测试责任

沿用 [#343 审计](test-responsibility-audit-343.md) 的用户风险标准。本次仅落实明确的低价值断言清理，不宣称对当前全部 193 个测试文件做过逐断言错误注入。

| 文件 | 变化与保留保障 |
| --- | --- |
| outbox-browser | 修复生命周期；保留两个引擎真实 IndexedDB 的去重、身份隔离、有界轮转与草稿不丢失。 |
| loading-stability | 删除所有小于 1px 位移断言，以及仅为 Markdown 操作弹窗尺寸启动的两次冷页旅程。保留生产 chunk 延迟、关闭后迟到模块不重开、附件内容保留、失败重试、加载期间入口与只读权限接线。附件增删与恢复由 attachments-smoke/recovery 继续覆盖，状态组合由 use-library-attachments 等单测覆盖。 |
| responsive-navigation | 首页四种状态乘四种宽度的外观矩阵改成 320px 下点击主要入口并打开对话框；删除必须铺满容器的 2px 宽度等式和强制次要按钮排列方式。其他控件可达、触摸尺寸与焦点返回检查保留。 |
| homepage-responsive | 保留 320/1024px 与放大文字的裁切、遮挡检查；删除两个中间断点和浏览器 viewport 设置值自检。 |

草稿/身份隔离、权限、离线、OCC、迁移、导出版本、真实文字命中、PDF canvas 层叠、PWA 和发布完整性测试均保留。它们保护应用自身的数据、接线或兼容责任，不能因依赖成熟库而整体删除。

## 本地验证

Node 24、锁文件安装：lint、build（含 typecheck/precache）通过；outbox 与 loading-stability 4/4，homepage-responsive 与 responsive-navigation 7/7 通过。

临时复制实际 outbox 测试，在 profile 回收后注入清理异常；两个真实浏览器均已关闭、profile 已移除，Vite 仍关闭，进程正常以失败码退出，没有等待超时。探针已删除，不新增永久测试来验证 Node 自身的钩子行为。正常与异常路径均经过验证；Linux CI 和真实设备状态单独报告。
