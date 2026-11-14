# 项目技能

引入以下项目技能，位于仓库根目录 `.agents/skills/`：

| 技能 | 适用场景 | 上游完整目录 |
| --- | --- | --- |
| `diagnosing-bugs` | 难复现故障、性能回退；先建立可观察信号，再缩小范围、验证假设 | `skills/engineering/diagnosing-bugs/` |
| `codebase-design` | 判断模块接口、依赖与测试位置；减少不必要的间接层 | `skills/engineering/codebase-design/` |
| `improve-codebase-architecture` | 用户主动发起架构巡检，先展示改进候选，再讨论选定项 | `skills/engineering/improve-codebase-architecture/` |
| `modern-web-guidance` | HTML/CSS/客户端 JS 任务先查询 Web 平台指南 | GoogleChrome `skills/modern-web-guidance/SKILL.md` 的项目适配 |

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

## Modern Web Guidance

沿用项目级 `.agents/skills` 方案，只安装 `modern-web-guidance`，不安装 Chrome 扩展技能或插件市场配置。检出分支后，新 Codex 会话可发现 `$modern-web-guidance`，无需全局或个人安装。保留上游工作流：HTML/CSS/客户端 JavaScript 任务先查指南；CLI 使用 `@latest`。不新增 CI 门禁，不改产品功能。

### 来源与隐私

技能来源：[GoogleChrome/modern-web-guidance@4dd968349e54ca45a05dd5c818fb035c9054b022](https://github.com/GoogleChrome/modern-web-guidance/tree/4dd968349e54ca45a05dd5c818fb035c9054b022)。本地保留完整上游流程，补充项目上下文、查询隐私规则及命令环境。Apache-2.0 全文、Google 版权、CC-BY 4.0 链接与指南署名见 [NOTICE.md](../../.agents/skills/modern-web-guidance/NOTICE.md) 和同目录 `LICENSE`；分享指南时保留原有署名、具体指南链接、许可与必要的改动标注。

每次调用都设 `DISABLE_TELEMETRY=1`、`ENABLE_FILE_LOGGING=false`、`npm_config_ignore_scripts=true`，包括 `pnpx`、重试和指南输出中的命令。查询只使用通用英文能力短语，禁止用户原话、凭据、邮箱、私人笔记、谱面、代码、日志、路径或业务标识；禁遥测不能替代脱敏。

```sh
DISABLE_TELEMETRY=1 ENABLE_FILE_LOGGING=false npm_config_ignore_scripts=true npx -y modern-web-guidance@latest search "light dismiss dialog"
DISABLE_TELEMETRY=1 ENABLE_FILE_LOGGING=false npm_config_ignore_scripts=true npx -y modern-web-guidance@latest retrieve "light-dismiss-a-dialog"
```

需要 Node.js **>=22** 及 npm/npx（或上游支持的 pnpx）。联网时 `@latest` 使用 npm 当时的最新版本，所执行版本可能随上游发布变化；本次实测解析为 `1.0.0`。npm 使用自身 registry 与缓存配置，不修改应用依赖清单；缓存不可写可设置 `NPM_CONFIG_CACHE=/tmp/mwg-npm-cache`。离线时按上游说明尝试 `npx --offline`，结果取决于缓存。当前实测版本使用包内静态检索数据，不需 API key；下载包仍需正常 registry 网络访问。

项目约束与用户授权优先，尤其是 Safari/iOS/PWA、离线数据和旧客户端兼容。结合相关 ADR 判断指南适用性，保留必要 fallback；Baseline 标签不替代真机证据。上游 `legacy-scan` 只用于用户明确要求的开放式全仓现代化/扫描，不用于普通功能修复。本安装不执行扫描、安装脚本、合并或部署。

### 验证与维护

已验证 frontmatter、来源与 LICENSE、相对引用、`git diff --check`。全新隔离 `CODEX_HOME` 的 Codex CLI `0.159.2` app-server 在仓库根和 `docs/agents` 均发现该项目技能（`scope: repo`、`enabled: true`、`errors: []`）。Node `24.19.0` / npm `11.9.0` 使用上述禁遥测环境真实执行 `@latest search` 和 `retrieve` 成功；CLI 当时为 `1.0.0`。

审查了该 npm 版本实际 CLI/search 与遥测分支：opt-out 在创建 watchdog 前返回。临时 Node 运行探测在 CLI 进程检查隐私环境并拦截常见 HTTP/HTTPS/net/TLS/DNS/fetch 与子进程入口，所测 search/retrieve 均无调用尝试。这是所测版本与路径的证据，不是对未来 `@latest` 版本的保证或 OS 抓包。真实发现与 CLI 检索分别验证；未做带模型的端到端自动选技、产品构建/测试或真机验收。

更新仓库中的技能说明时，从选定上游提交同步完整 `SKILL.md`，保留查询隐私环境与项目上下文，同步 NOTICE/许可并验证发现与真实检索。CLI 按上游 `@latest` 方式获取，无需修改仓库版本号。删除时移除 `.agents/skills/modern-web-guidance/` 并更新本文，无全局安装需要卸载。
