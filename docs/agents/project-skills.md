# 项目技能

引入以下项目技能，位于仓库根目录 `.agents/skills/`：

| 技能 | 适用场景 | 上游完整目录 |
| --- | --- | --- |
| `diagnosing-bugs` | 难复现故障、性能回退；先建立可观察信号，再缩小范围、验证假设 | `skills/engineering/diagnosing-bugs/` |
| `codebase-design` | 判断模块接口、依赖与测试位置；减少不必要的间接层 | `skills/engineering/codebase-design/` |
| `improve-codebase-architecture` | 用户主动发起架构巡检，先展示改进候选，再讨论选定项 | `skills/engineering/improve-codebase-architecture/` |
| `modern-web-guidance` | 按需解答具体 Web 平台问题；非必跑、非现代化门禁 | GoogleChrome `skills/modern-web-guidance/SKILL.md` 的项目适配 |

不安装整套工作流、setup、triage、TDD 或自动更新工具；已有项目配置继续使用。

## mattpocock 技能来源与许可

- 上游：[mattpocock/skills](https://github.com/mattpocock/skills)。
- 固定提交：[`5863806dd4e15c63174bee4e7515a4256792ecfa`](https://github.com/mattpocock/skills/tree/5863806dd4e15c63174bee4e7515a4256792ecfa)，审查日期：2026-11-14。
- 三个目录共 10 个文件，保持上游内容逐字节一致，包含 `agents/openai.yaml`、设计参考和 HITL shell 模板；不复制上游项目的 `AGENTS.md` 或安装脚本。
- 上游 MIT 许可及 Matt Pocock 的版权声明完整保存在 [LICENSE.mattpocock](../../.agents/skills/LICENSE.mattpocock)。这些第三方文件继续适用 MIT，项目原创内容的许可见根目录 `LICENSE`。

## SamePage 使用边界

技能是方法参考，系统与开发者要求、用户指令及项目规则优先。按当前任务授权执行；技能中的强制措辞不会扩大访问、写入、发布、合并或部署权限。

- **领域词汇**：上游提到的 `GLOSSARY.md` 在本项目对应根目录 `CONTEXT.md`；按 [domain.md](domain.md) 阅读相关 ADR。设计词汇用于讨论模块，不替换项目领域名称或强制重命名 React component、API 等已有概念。
- **复现与结论**：优先复用现有测试、诊断入口和最小本地反馈循环。先读代码寻找复现入口是合理的。上游“先复现再假设”用于避免无证据修复；环境不可得时记录已尝试的方法、候选假设与缺失证据，等待必要信息。模拟器、静态分析或未访问用户设备不能证明实机根因或实机验收通过。
- **压力与数据**：上游 100 次循环、并发与模糊测试只是可选方法；按问题需要设定有限次数和停止条件，只在隔离的本地／测试环境使用合成或已脱敏数据。访问生产、增加生产插桩、回放真实请求、执行生产写入均需任务已有明确授权，并遵守生产数据和兼容性规则；技能本身不提供授权。
- **必要验证**：遵循 [CI 检查与开发反馈](../operations/ci.md)，保留能捕获实际故障的最少核心回归。存在合适测试位置时才新增必要测试；不为满足阶段清单无限叠加测试，也不因上游“replace, don't layer”直接删除现有门禁。无法自动覆盖时说明验证缺口。
- **附属脚本**：`diagnosing-bugs/scripts/hitl-loop.template.sh` 已逐行审查，只定义 `step` / `capture`，等待人工输入并将结果回显；没有下载、网络调用、`eval` 或生产操作。它是参考模板，安装时不执行。实际使用前需重新审查和适配：其中 localhost:3000 / Export 是上游示例，非 SamePage 复现步骤。只采集脱敏观察，不采集密码、token、认证头、私人笔记或谱面；输出进入终端和会话，不能把未脱敏 HAR／日志直接粘贴进去。
- **设计范围**：`DESIGN-IT-TWICE.md` 的多 agent 比较只在任务确实需要探索替代接口、且当前工具与指令允许时采用；普通修复采用简单实现，不自动扩展为架构重写。

## 架构巡检的项目适配

`improve-codebase-architecture` 完整目录含 3 个纯文本文件，无附属可执行脚本；其工作流和 HTML 示例已审查。保留上游原文，使用时以下项目适配优先：

- `codebase-design` 已安装；上游后续步骤调用的 `grilling`、`domain-modeling` 未安装。本项目明确用普通对话逐项澄清约束、依赖、接口与必要测试，并按 [domain.md](domain.md) 维护现有 `CONTEXT.md`／ADR 来替代这两个调用。不要假装调用了缺失技能，也不自动安装依赖或另建 `GLOSSARY.md`。
- 先给出候选，等待用户选择后再深入；巡检不自动实施重构。子 agent 探索仅在当前工具与指令允许时使用，否则由当前 agent 完成并说明。
- `HTML-REPORT.md` 的示例会从 Tailwind／jsDelivr CDN 加载脚本，并将 Mermaid 设为 `securityLevel: "loose"`。本项目报告改用内联 CSS 和静态 SVG，不加载 CDN、不采用 loose 模式；转义来自仓库的文本，不将其作为 HTML 或脚本插入。报告只含必要架构信息，不含秘密或私人内容。
- 报告写入临时目录，打开浏览器和交付文件遵循当前环境可用工具与权限；不因上游 `xdg-open` 示例而绕过环境要求，也不自动发布报告。

## 发现与验证边界

按 [Codex 官方技能说明](https://learn.chatgpt.com/docs/build-skills)，从仓库根目录或其子目录启动时，Codex 会沿当前目录至仓库根目录检查 `.agents/skills`。这里每个技能直接包含 `SKILL.md`，frontmatter 有非空 `name` 和 `description`，名称与目录一致；前两个技能的 `agents/openai.yaml` 仅含 UI 元数据，允许默认的显式与隐式调用；架构巡检保留上游 `disable-model-invocation: true` 与 `policy.allow_implicit_invocation: false`，仅显式调用。三者均无 MCP 依赖。可用 `$diagnosing-bugs`、`$codebase-design` 或 `$improve-codebase-architecture` 显式请求；架构巡检的两个未安装技能调用按上节适配。

本次仅静态核验文件布局、YAML、目录完整性、引用和模板 shell 语法。未在新 Codex 任务中验证发现或实际调用，也未运行调试模板、应用构建或产品测试；这些文件不改变运行时产品代码。个人配置可能禁用技能或造成同名技能重复，实际可见性以使用者环境为准。

## mattpocock 技能手动更新与删除

更新时先选定完整上游 commit SHA，审查三个目录及根目录许可的 diff，尤其关注脚本、外部依赖和权限指令。用该 SHA 的完整所选目录替换本地副本，删除上游已移除的文件；同步 MIT 许可、本文 SHA／文件数／审查说明，通过独立 PR 审核。不执行上游安装脚本，不添加自动追踪或定时更新。

验证时解析 `SKILL.md` frontmatter 和 `agents/openai.yaml`；核对文件清单、内容与固定 SHA 一致，所有技能内相对引用均有目标；对 shell 模板只运行 `bash -n`。用 `git diff --check` 检查补丁，并核实 diff 只涉及技能及说明。若以后做真实调用验证，另记任务、环境与结果。

删除某技能时删除 `.agents/skills/<name>/` 整个目录并更新本文；删除最后一个 mattpocock 技能时移除 `LICENSE.mattpocock`；仅当所有项目技能均删除时，再移除本文和 `AGENTS.md` 的 Project skills 段落。无需卸载命令，无个人配置或外部服务需要清理。

## Modern Web Guidance（按需参考）

PR [#654](https://github.com/clydian/same-page/pull/654) 已合并，本技能沿用相同的项目级 `.agents/skills` 方案，不重复安装其他技能。检出本 PR 即完成项目安装；无需全局安装、个人配置或上游安装器。在新 Codex 会话中可用 `$modern-web-guidance`，也可针对具体 Web 平台疑问按需调用。它不是每个前端任务的必跑步骤，不进入 CI、不要求扫描或强制现代化。

### 固定来源、运行与隐私

- 审查日期：2026-11-14。技能来源为 [GoogleChrome/modern-web-guidance@4dd968349e54ca45a05dd5c818fb035c9054b022](https://github.com/GoogleChrome/modern-web-guidance/tree/4dd968349e54ca45a05dd5c818fb035c9054b022)。只适配 `modern-web-guidance/SKILL.md`，不安装 `chrome-extensions`、插件市场配置或上游安装脚本；不复制数百份指南与二进制数据。
- CLI 独立固定为 npm `modern-web-guidance@1.0.0`；对应 skill 标识 `2026_11_09-5bcc021b`。审查的是实际 npm tarball 的 `modern-web.mjs`、`search.mjs` 及其 source map、包清单、数据/指南布局与许可，不能用 Git 技能版本替代运行时代码审查。包无安装生命周期脚本或外部 npm 依赖，所需模块与检索数据已打包；未执行 install/update、扫描器或实验 opt-in。
- npm tarball SHA-256：`bd7aa623ad10710a9ad6678fdbcc0b890c903c54fd6abfc126ff42de01f0e577`；registry SRI：`sha512-vafIZwC8AS6QjM2yyoflZbnc7n3/TVOMLbEMRdPTwcFy0f9/Tq8s5rJQ8UIqRt2KPl9ixravyaMR4nTGuUrcmg==`。用于更新审查核对；运行依赖 npm 对固定版本和缓存的完整性检查，未另建下载器或包镜像。
- 所有调用使用 [lookup.sh](../../.agents/skills/modern-web-guidance/scripts/lookup.sh)。该入口仅允许 `search`、`retrieve`、`list`，强制 `DISABLE_TELEMETRY=1`、`ENABLE_FILE_LOGGING=false`、npm `--ignore-scripts`，固定精确包版本。上游默认遥测可能发送查询、调用 agent、指南 ID 等；审查确认此版本 opt-out 会在创建遥测 watchdog 前返回。不要绕过入口，也不要执行指南输出中的 `@latest`、更新、安装或策略 opt-in 命令。
- 查询只用一个能力的通用英文短语，禁止发送用户原话、秘密、邮箱、私人笔记、谱面、源代码、日志、路径或业务标识。命令参数仍可能进入终端/会话/npm 错误日志，禁遥测不能替代脱敏。
- Apache-2.0 完整许可、修改标注、Google 与 MDN/Mozilla、W3C、WHATWG、IETF 来源，以及指南的 CC-BY 4.0 署名要求见 [NOTICE.md](../../.agents/skills/modern-web-guidance/NOTICE.md) 和同目录 `LICENSE`。引用/转发指南时保留具体指南链接、许可与原有署名，并标注改动。

从仓库根目录运行（子目录请按仓库根解析路径）：

```sh
sh .agents/skills/modern-web-guidance/scripts/lookup.sh search "light dismiss dialog"
sh .agents/skills/modern-web-guidance/scripts/lookup.sh retrieve "light-dismiss-a-dialog"
```

需要 POSIX `sh`、Node.js **>=22** 和提供 `npm exec` 的 npm。首次运行需访问配置的 npm registry（默认 registry.npmjs.org）下载约 16.5 MB 解包内容；npm 使用自身缓存和网络配置，不会增加应用 `package.json` 或 lockfile。缓存不可写时可在命令前指定 `NPM_CONFIG_CACHE=/tmp/mwg-npm-cache`。完整缓存后可加 `npm_config_offline=true`；缓存缺失仍会失败。此固定版本搜索使用包内 BM25/静态向量，取回读取包内 Markdown，不需要在线模型、API key 或远端查询服务。下载过程仍有正常 registry 网络访问；查阅失败时说明限制，不把它变成阻止产品修复的门禁。

### 项目适配与兼容性

本地 `SKILL.md` 是明确标注的精简修改版，移除了上游 MANDATORY、默认现代化与固定报告格式等要求。指南只作为证据参考；不因上游偏好强加新 API、`any` 类型断言、`esnext`、polyfill 或依赖。先读当前任务相关 ADR，特别是 [离线访问](../adr/0004-allow-verified-offline-access-without-requiring-installation.md)、[PDF.js legacy 路径](../adr/0013-use-legacy-pdf-display.md) 与 [版本化应用壳](../adr/0020-versioned-application-shells.md)。保留 iOS/Safari/PWA、离线数据与旧客户端兼容；Baseline 标签不替代项目支持策略或真机证据，不据指南删除现有 fallback。不新增 `.mwgrc` 或放宽实验功能配置；不运行 `legacy-scan`。

### 验证证据与边界

- **静态**：frontmatter/名称与目录校验、引用/来源/Apache 文件一致性、`sh -n` 和 `git diff --check`。检查入口只允许三个只读子命令，固定版本/隐私环境且不运行 lifecycle hooks；无产品、CI、依赖清单或发布配置改动。
- **实测发现**：本 Cloud 环境现有 Codex CLI `0.159.2`，使用全新 `/tmp` 隔离 `CODEX_HOME` 启动 `codex app-server --listen stdio://`，initialize 后执行 `skills/list`（`forceReload: true`）。仓库根与 `docs/agents` 两个 cwd 都返回 `modern-web-guidance`，路径指向本仓库、`scope: repo`、`enabled: true`、`errors: []`；原有三个技能仍可见。
- **实测检索**：Node `24.19.0` / npm `11.9.0`、全新临时 npm 缓存，经项目入口搜索 `light dismiss dialog` 返回 10 条结果，首条为 `light-dismiss-a-dialog`；成功取回返回列表中的 `dialog`，完整输出 12,425 字节。
- **运行时隐私**：缓存后以 npm offline 重跑相同 search/retrieve。临时 Node preload 在实际 CLI 进程断言遥测为 `1`、文件日志为 `false`，拦截常见 Node HTTP/HTTPS/net/TLS/DNS/fetch 和子进程入口；两次均成功且无调用尝试（因此也未启动遥测 watchdog）。这是对该版本与这两条路径的运行探测，不是操作系统级抓包，也不声称 npm 首次下载无网络。
- 真实发现和真实 CLI 检索分别验证；未启动带模型的端到端自动选技回合，不证明当前聊天热刷新或所有用户个人配置可见。未运行应用构建/产品测试或真机验收，技能文件不改变产品行为。

### 手动更新与删除

不自动更新。另开 PR，选定上游完整 SHA 和 npm 精确版本；先下载但不运行安装脚本，核对 tarball hash/SRI、来源和许可，重新审查实际 CLI/search 代码、网络/遥测/日志/子进程与依赖变化。对照固定旧 SHA 的原技能审查 diff，将必要变化移植到项目适配版；保留按需与兼容性边界。同步入口的 CLI/skill 标识、本文、NOTICE 与 LICENSE；重新做隔离 Codex 发现和禁遥测真实检索验证。上游更新提示仅是信息，不提供自动升级授权。

删除时只移除 `.agents/skills/modern-web-guidance/` 并更新本文，无全局安装需要卸载。临时 npm 缓存按环境清理；不调用上游 uninstall，不影响其他项目技能。
