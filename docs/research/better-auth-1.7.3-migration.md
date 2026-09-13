# Better Auth 1.7.3 认证身份迁移核实

核实日期：2026-09-13。范围：上游 PR #11153 及其合并提交 `2220ee726934de3aa128d5b4114391be8e9570cc`；未查询或修改生产数据。

## 已核实事实

- 1.7.0–1.7.2 要求 `account.issuer` 非空，并以 `(issuer, accountId)` 建立唯一索引。1.7.3 撤回该 schema 变更，恢复 `(providerId, accountId)` 身份语义；新记录不再写入 `issuer`。这是有意的上游变更，不是合谱密码长度规则导致的问题。[上游 PR](https://github.com/better-auth/better-auth/pull/11153)
- 官方要求已应用旧 schema 的数据库放松 `issuer` 非空约束，并移除旧唯一索引。一般说明允许先保留可空列、以后清理；SQLite 专节因没有 `ALTER COLUMN`，给出的简便路径是先删除索引，再删除列。**保留 nullable 列的 SQLite 表重建方案属于合谱的兼容性设计，不是官方 SQLite 示例。**[固定版本升级指南](https://github.com/better-auth/better-auth/blob/2220ee726934de3aa128d5b4114391be8e9570cc/docs/content/docs/guides/1-7-upgrade-guide.mdx)
- 官方要求升级前检查 `(providerId, accountId)` 重复键。不同 issuer 若映射到相同 provider ID 与 account ID，需调整 provider 映射并保留不同用户的独立身份，不能擅自合并。运行时查询最多取两条，发现歧义即拒绝。[升级指南](https://github.com/better-auth/better-auth/blob/2220ee726934de3aa128d5b4114391be8e9570cc/docs/content/docs/guides/1-7-upgrade-guide.mdx)、[查询实现变更](https://github.com/better-auth/better-auth/commit/2220ee726934de3aa128d5b4114391be8e9570cc)
- 上游生成的 SQLite schema 移除了 issuer 唯一索引，保留 `userId` 普通索引；没有自动加入 `(providerId, accountId)` 唯一索引。因此新增该唯一索引应明确为合谱的数据完整性约束，而不是声称官方迁移要求。[固定版本生成快照](https://github.com/better-auth/better-auth/blob/2220ee726934de3aa128d5b4114391be8e9570cc/packages/cli/test/__snapshots__/auth-schema-sqlite.txt)

## 建议与边界

建议按扩展兼容、切换应用、后续清理三步推进：先审计重复键和 provider/issuer 映射，在 D1 测试环境验证保留所有列值及关联记录的表重建，令 `issuer` 可空、移除旧索引，并在重复键为零后加入 `(providerId, accountId)` 唯一索引；之后部署统一版本的 Better Auth 依赖。保留 issuer 原值仅为过渡与审计，不应永久接管上游已撤回的 issuer 写入逻辑。

**可空列不等于应用可直接回滚。** 上游旧代码在身份查询、密码更新与删除等路径中使用 issuer 条件；1.7.3 新增记录的 issuer 为 NULL 后，1.7.2 可能无法识别或更新这些记录。该风险由代码差异推导，不是已完成的合谱回滚实验。[内部适配器](https://github.com/better-auth/better-auth/blob/2220ee726934de3aa128d5b4114391be8e9570cc/packages/better-auth/src/db/internal-adapter.ts)、[完整差异](https://github.com/better-auth/better-auth/commit/2220ee726934de3aa128d5b4114391be8e9570cc)

上线前应准备并实测兼容新 schema 的应用回滚版本，或者另行验证停写、按旧版本实际 provider 语义回填新增 issuer、检查冲突后回退的流程。不能把恢复上线前数据库备份作为无损回滚，因为它会丢弃上线后新增账户、会话及业务变化。直接删除列也会使仍在运行的 1.7.2 写入端失效，必须纳入部署顺序设计。

最低验收包括：旧账户密码与 Google 登录、新注册与首次设密、重置密码、绑定/解绑、不同 provider 同 account ID 可共存、同 provider 重复身份被拒绝，以及新版本新增账户后执行回滚演练。迁移前后需比较账户数量、主键、用户关联、密码哈希、会话及外键完整性。
