# 个人层管理 module

[`usePersonalLayerManagement`](../../src/client/reader/use-personal-layer-management.ts) 集中个人层创建、命名、分享、删除和恢复的操作生命周期。面板和卡片提交内容意图，展示 module 提供的反馈；不再拼装请求、判定刷新重试或独立读取本地草稿。

```text
面板 / 个人层卡片
    │ 创建、修改、读取已删除列表、重试
    ▼
个人层管理 module
    ├─ 稳定创建身份、层修订号、同步操作准入
    ├─ 每次删除前检查本地草稿和本地冲突
    ├─ 写入确认 → 阅读同步 → 已请求的已删除列表
    └─ 工作空间会话校验、卸载取消、目标行消失后的反馈
```

`startCreation` / `cancelCreation` 管理创建意图的有效期，名称输入仍由视图持有。未确认创建重试沿用原 ID；收到成功响应即退出创建输入，刷新失败不重新创建。取消未确认输入退役其重试入口，但不能撤回可能已经到达服务端的请求。

`change` 接受个人层及修改意图，在准入时捕获层身份、名称与修订号。初次删除和未确认删除重试都重新检查本机内容；有未同步笔记、冲突或本机读取失败时不发送删除。已确认修改只恢复刷新；409 后刷新当前事实，并要求核对后重新操作。未确认请求仍沿用既有稳定 ID / expectedRevision 重试约定，不引入新的服务端协议。

提交和重试共用同步 gate，React 尚未更新按钮状态时也不能重复准入。操作捕获本机工作空间会话，并在异步读取、请求和恢复后校验；失败路径也校验，避免丢失响应绕过会话检查。面板按工作空间和会话挂载，卸载取消后续工作；云端登录失效即使保留本机身份，也取消待完成请求和恢复入口，保留名称输入。失效操作不继续同步或发布旧反馈。

这里没有复用 `useSettingsMutation` 的结果分类：个人层保留未确认创建的同 ID 重放、删除前本机检查与既有提示语义，不为这一处调用扩大通用设置 module 的 interface。复用现有工作空间、生命周期与阅读同步 implementation。图层订阅仍由阅读偏好的独立队列处理，表单、确认弹窗和焦点仍由视图处理。

## 验证与兼容性

`use-personal-layer-management.test.tsx` 通过公开 interface 与可控 HTTP adapter、fake-indexeddb 验证操作恢复和有效期；`reader-layer-panel.test.tsx` 保留显示/管理、确认、输入与焦点及反馈接线回归。没有 mock 内部 module。

依据 [#376](https://github.com/clydian/same-page/issues/376)，保持 [ADR-0014](../adr/0014-configurable-and-published-layers.md) 和 [ADR-0016](../adr/0016-independent-personal-layers-and-note-colors.md) 的身份、隐私、修订号及草稿保护语义。没有服务端、数据库、IndexedDB 或笔记格式迁移。
