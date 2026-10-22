# 运营 CLI

用于少量运营者的查谱、下载、导入候选和状态查询。直接使用现有产品后台接口，Node.js 24+，无额外 CLI 依赖。在仓库根目录运行 `npm ci` 后即可使用。

## 创建令牌

使用现有账号登录 `/admin`，打开「CLI 令牌」，填写名称、选择云盘和有效期（7 或 30 天）。默认只读；有检查权限的运营者可选择「允许上传候选」。完整令牌只在创建后显示一次，离开后无法再次查看；丢失时撤销并新建。

实际权限是令牌范围、当前运营授权、当前试点云盘范围的交集。撤销运营授权、停用云盘、令牌撤销或到期后，后续请求即被拒绝。令牌不加入云盘、不授予笔记、成员管理、检查、发布或其他后台功能。网页登录继续使用原会话和权限。

CLI 只读取环境变量，不保存令牌或密码。macOS 默认 zsh 可用以下方式输入，令牌值不会成为 shell 历史命令：

```zsh
read -rs 'SAME_PAGE_TOKEN?粘贴 CLI 令牌：'
export SAME_PAGE_TOKEN
printf '\n'
npm run --silent cli -- drives --json
```

默认站点为 `https://samepage.clyapps.com`。本地开发可显式设置 `SAME_PAGE_URL=http://localhost:5173`；其他站点必须使用 HTTPS 根地址。CLI 拒绝重定向，避免把凭据转交给其他地址。远程任务从其 secret 环境注入 `SAME_PAGE_TOKEN`，使用单独命名、限定云盘和期限的令牌。

## 常用命令

把以下 `SCORE_ID`、`DRIVE_ID`、`VERSION_ID`、`CANDIDATE_ID` 替换为实际 ID。

```sh
npm run --silent cli -- drives --json
npm run --silent cli -- scores --drive DRIVE_ID --query 'If Music' --json
npm run --silent cli -- status SCORE_ID --json
npm run --silent cli -- download-pdf SCORE_ID --out source.pdf --json
npm run --silent cli -- upload SCORE_ID result.musicxml --source-version VERSION_ID --json
npm run --silent cli -- status SCORE_ID --candidate CANDIDATE_ID --json
npm run --silent cli -- download-xml SCORE_ID --candidate CANDIDATE_ID --out candidate.musicxml --json
npm run --silent cli -- download-xml SCORE_ID --out published.musicxml --json
```

`scores` 自动读取全部分页，可选 `--filter all|missing|review|stale|failed|disabled`。`status` 返回服务端详情，包括候选状态、检查结论、来源版本、正式附件修订；候选历史最多返回 100 条，保留服务端 `nextBefore` 提示，较早候选可用 `--candidate` 精确查询。

下载 PDF 会先读取当前来源版本，再按该不可变版本下载，检查 SHA-256，输出来源版本和校验值；可加 `--version VERSION_ID` 要求当前来源仍是指定版本。它只下载当前来源 PDF，不会悄悄把旧版本任务改绑到新 PDF。候选下载同样检查 SHA-256；正式版下载固定当前附件修订，输出实际下载校验值。下载必须指定 `--out`，不会覆盖已有文件。

上传必须显式提供校谱所用的 `--source-version`，接受非空 XML/MusicXML/MXL，最大 20 MiB。CLI 计算文件长度与 SHA-256，服务端独立校验。上传仅形成后台候选，不会审核或公开发布；格式校验通过也不代表播放器、音高、节奏等检查通过。

## 重试与错误

每次上传先在 stderr 输出候选 UUID，成功结果也含此 ID。网络中断后，保留相同文件、文件名、来源版本和 ID，用 `--id` 重试：

```sh
npm run --silent cli -- upload SCORE_ID result.musicxml --source-version VERSION_ID --id CANDIDATE_ID --json
```

同一次已完成上传会返回原候选；正在上传、已失败或内容变化会返回 `409 import_conflict`。此时先查询 `status`，不要不断更换 ID 重复上传。来源 PDF 改变、用户移除生成版、权限变化、额度不足等冲突沿用服务端规则，CLI 不自动覆盖。上传最终提交再次验证令牌、运营授权和云盘范围，上传期间撤销不会提交成可用候选。

`--json` 时 stdout 仅输出成功 JSON，提示与失败写入 stderr，失败退出码为 1。`401/403` 需检查令牌与权限；`404` 可能表示不在令牌范围、父资源不可用或已到期；`409` 需重新读取状态；`429` 按服务端 `Retry-After` 稍后重试。CLI 不自动重试写请求。

使用结束可 `unset SAME_PAGE_TOKEN`。凭据不应写入仓库、日志、命令参数或任务文本。

## 发布与回退

先应用增量迁移 `0035_admin_cli_tokens.sql`，再部署 Worker/客户端。迁移只新增令牌表及索引，不修改现有会话、运营授权、成员关系、谱面数据或发布触发器，不自动创建令牌。旧 Worker 可以继续运行；回退时保留新增表，不删除用户数据。

验证 Cookie 登录原有查谱、导入、检查、发布仍正常，再用合成测试账号检查令牌边界。上线和生产授权是独立操作；提交 PR 不表示已部署或已为任何运营者创建凭据。
