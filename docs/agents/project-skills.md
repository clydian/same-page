# 项目技能

仅引入两个项目技能，位于仓库根目录 `.agents/skills/`：

| 技能 | 适用场景 | 上游完整目录 |
| --- | --- | --- |
| `diagnosing-bugs` | 难复现故障、性能回退；先建立可观察信号，再缩小范围、验证假设 | `skills/engineering/diagnosing-bugs/` |
| `codebase-design` | 判断模块接口、依赖与测试位置；减少不必要的间接层 | `skills/engineering/codebase-design/` |

不安装整套工作流、setup、triage、TDD 或自动更新工具；已有项目配置继续使用。

## 来源与许可

- 上游：[mattpocock/skills](https://github.com/mattpocock/skills)。
- 固定提交：[`5863806dd4e15c63174bee4e7515a4256792ecfa`](https://github.com/mattpocock/skills/tree/5863806dd4e15c63174bee4e7515a4256792ecfa)，审查日期：2026-11-14。
- 两个目录共 7 个文件，保持上游内容逐字节一致，包含 `agents/openai.yaml`、设计参考和 HITL shell 模板；不复制上游项目的 `AGENTS.md` 或安装脚本。
- 上游 MIT 许可及 Matt Pocock 的版权声明完整保存在 [LICENSE.mattpocock](../../.agents/skills/LICENSE.mattpocock)。这些第三方文件继续适用 MIT，项目原创内容的许可见根目录 `LICENSE`。

## SamePage 使用边界

技能是方法参考，系统与开发者要求、用户指令及项目规则优先。按当前任务授权执行；技能中的强制措辞不会扩大访问、写入、发布、合并或部署权限。

- **领域词汇**：上游提到的 `GLOSSARY.md` 在本项目对应根目录 `CONTEXT.md`；按 [domain.md](domain.md) 阅读相关 ADR。设计词汇用于讨论模块，不替换项目领域名称或强制重命名 React component、API 等已有概念。
- **复现与结论**：优先复用现有测试、诊断入口和最小本地反馈循环。先读代码寻找复现入口是合理的。上游“先复现再假设”用于避免无证据修复；环境不可得时记录已尝试的方法、候选假设与缺失证据，等待必要信息。模拟器、静态分析或未访问用户设备不能证明实机根因或实机验收通过。
- **压力与数据**：上游 100 次循环、并发与模糊测试只是可选方法；按问题需要设定有限次数和停止条件，只在隔离的本地／测试环境使用合成或已脱敏数据。访问生产、增加生产插桩、回放真实请求、执行生产写入均需任务已有明确授权，并遵守生产数据和兼容性规则；技能本身不提供授权。
- **必要验证**：遵循 [CI 检查与开发反馈](../operations/ci.md)，保留能捕获实际故障的最少核心回归。存在合适测试位置时才新增必要测试；不为满足阶段清单无限叠加测试，也不因上游“replace, don't layer”直接删除现有门禁。无法自动覆盖时说明验证缺口。
- **附属脚本**：`diagnosing-bugs/scripts/hitl-loop.template.sh` 已逐行审查，只定义 `step` / `capture`，等待人工输入并将结果回显；没有下载、网络调用、`eval` 或生产操作。它是参考模板，安装时不执行。实际使用前需重新审查和适配：其中 localhost:3000 / Export 是上游示例，非 SamePage 复现步骤。只采集脱敏观察，不采集密码、token、认证头、私人笔记或谱面；输出进入终端和会话，不能把未脱敏 HAR／日志直接粘贴进去。
- **设计范围**：`DESIGN-IT-TWICE.md` 的多 agent 比较只在任务确实需要探索替代接口、且当前工具与指令允许时采用；普通修复采用简单实现，不自动扩展为架构重写。

## 发现与验证边界

按 [Codex 官方技能说明](https://learn.chatgpt.com/docs/build-skills)，从仓库根目录或其子目录启动时，Codex 会沿当前目录至仓库根目录检查 `.agents/skills`。这里每个技能直接包含 `SKILL.md`，frontmatter 有非空 `name` 和 `description`，名称与目录一致；两份 `agents/openai.yaml` 仅含 UI 元数据，允许默认的显式与隐式调用，无 MCP 或外部工具依赖。可用 `$diagnosing-bugs` 或 `$codebase-design` 显式请求。

本次仅静态核验文件布局、YAML、目录完整性、引用和模板 shell 语法。未在新 Codex 任务中验证发现或实际调用，也未运行调试模板、应用构建或产品测试；这些文件不改变运行时产品代码。个人配置可能禁用技能或造成同名技能重复，实际可见性以使用者环境为准。

## 手动更新与删除

更新时先选定完整上游 commit SHA，审查两个目录及根目录许可的 diff，尤其关注脚本、外部依赖和权限指令。用该 SHA 的完整所选目录替换本地副本，删除上游已移除的文件；同步 MIT 许可、本文 SHA／文件数／审查说明，通过独立 PR 审核。不执行上游安装脚本，不添加自动追踪或定时更新。

验证时解析 `SKILL.md` frontmatter 和 `agents/openai.yaml`；核对文件清单、内容与固定 SHA 一致，所有技能内相对引用均有目标；对 shell 模板只运行 `bash -n`。用 `git diff --check` 检查补丁，并核实 diff 只涉及技能及说明。若以后做真实调用验证，另记任务、环境与结果。

删除某技能时删除 `.agents/skills/<name>/` 整个目录并更新本文；删除最后一个上游技能时同时移除 `LICENSE.mattpocock`、本文和 `AGENTS.md` 的 Project skills 段落。无需卸载命令，无个人配置或外部服务需要清理。
