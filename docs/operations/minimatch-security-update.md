# minimatch 开发依赖安全更新

针对 [GHSA-g3hv-75wg-m249 / CVE-2026-118764](https://github.com/advisories/GHSA-g3hv-75wg-m249)：受影响范围为 `>=7.0.0 <11.0.1`，恶意 glob 在 `optimizationLevel >= 2` 时可能放大预处理工作量。

## 修复范围与兼容性

本次不使用 `npm audit fix --force`，不降级 `@eslint/js`，不修改 lint 规则或 CI 门禁。保留 ESLint 10.9.1、TypeScript ESLint 8.72.0、Workbox 7.4.1，使用按消费者限定的临时 npm overrides：

- `eslint`、`@eslint/config-array@0.23.5`、`@typescript-eslint/typescript-estree@8.72.0` 的 minimatch 固定为 11.0.4。这三处只使用公开的 `Minimatch`、`match()`（含 partial）及 `minimatch()` API，不依赖被删除的 `makeRe()`、AST 或内部正则表示。
- `workbox-build@7.4.1` 的 glob 固定为 14.0.3，使用其原生支持的 minimatch 11。Workbox 使用的 `globSync(pattern, {cwd, follow, ignore})` 接口仍存在。
- 不直接把 glob 11 的 minimatch 覆盖成 11：minimatch 11 的 `set` 元素由 `RegExp` 改为 `Matcher`，旧 glob 依赖 `instanceof RegExp`，存在静默漏掉缓存文件的风险。

minimatch 11 还删除了 `matchOne()`、`slashSplit()` 等内部接口，修正 partial、空路径段和 Windows UNC 路径的行为。这里不声称它对所有 10.x 消费者都兼容。项目与 CI 使用 Node.js 24，满足新版依赖要求。`filelist` 的独立 minimatch 5.1.9 不在本公告范围内，保持原样；Android 独立锁文件也不修改。

## 验证与后续维护

`scripts/development-globs.test.js` 随 Node 单元测试运行，验证四个实际消费者的解析版本、文件匹配与 partial API、受限模式展开，以及 Workbox 的嵌套文件发现和排除行为。生产构建继续执行现有 precache 完整性、必需资源和字节预算检查。

升级 ESLint、config-array、typescript-estree 或 Workbox 时重新检查这些覆盖；上游原生支持修复版本后优先移除对应 override。config-array、typescript-estree 与 Workbox 的覆盖限定了消费者版本；ESLint 的覆盖跟随直接依赖，当前验证版本为 10.9.1。更新后必须检查 `npm ls minimatch --all`、锁文件与回归测试，防止再次引入受影响版本或沿用不兼容覆盖。本 PR 仅修复该公告，不代表其他依赖漏洞已全部消除。

上游参考：[minimatch 11 变更记录](https://github.com/isaacs/minimatch/blob/v11.0.4/changelog.md)、[glob 14.0.3](https://github.com/isaacs/node-glob/tree/v14.0.3)。
