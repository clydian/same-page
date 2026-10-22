#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { open, readFile, unlink } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const help = `Same Page 运营 CLI（Node.js 24+）

用法：npm run --silent cli -- COMMAND [OPTIONS]
  drives                                  列出令牌可访问的云盘
  scores [--drive ID] [--query TEXT] [--filter STATE]
                                          查谱，自动读取全部分页
  status SCORE [--candidate ID]             查询乐谱和候选状态
  download-pdf SCORE --out FILE [--version ID]
                                          下载当前来源 PDF；version 为预期版本
  download-xml SCORE --out FILE [--candidate ID]
                                          下载正式 XML，或指定候选
  upload SCORE FILE --source-version ID [--id UUID]
         [--tool TEXT] [--parameters TEXT] 上传候选，不审核或发布

通用选项：--json 输出 JSON；--help 显示帮助
环境变量：SAME_PAGE_TOKEN 必填；SAME_PAGE_URL 默认 https://samepage.clyapps.com
令牌由已登录的产品后台创建。仅支持 HTTPS（本机开发可用 HTTP）。`;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function originFrom(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error("SAME_PAGE_URL 必须是有效的站点地址。"); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && local)) ||
    url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("SAME_PAGE_URL 必须是 HTTPS 站点根地址；仅本机允许 HTTP。");
  }
  return url.origin;
}

// Downloads never overwrite an existing file or leave a file after a failed write.
async function saveFile(file, bytes) {
  const handle = await open(file, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
  } catch (error) {
    await handle.close();
    await unlink(file).catch(() => {});
    throw error;
  }
  await handle.close();
}

export async function runCli(argv, {
  env = process.env,
  fetch: request = globalThis.fetch,
  write = (text) => process.stdout.write(text + "\n"),
  warn = (text) => process.stderr.write(text + "\n"),
} = {}) {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" }, json: { type: "boolean" },
      drive: { type: "string" }, query: { type: "string" }, filter: { type: "string" },
      candidate: { type: "string" }, out: { type: "string" }, version: { type: "string" },
      "source-version": { type: "string" }, id: { type: "string" },
      tool: { type: "string" }, parameters: { type: "string" },
    },
  });
  if (values.help || positionals.length === 0) { write(help); return; }
  const [command, scoreId, file, ...extra] = positionals;
  if (!new Set(["drives", "scores", "status", "download-pdf", "download-xml", "upload"]).has(command)) {
    throw new Error("未知命令。使用 --help 查看用法。");
  }
  const count = command === "upload" ? 3 : ["drives", "scores"].includes(command) ? 1 : 2;
  if (extra.length || positionals.length !== count) throw new Error("命令参数不完整或多余。使用 --help 查看用法。");
  if (scoreId === "." || scoreId === "..") throw new Error("无效的乐谱 ID。");
  const scoreKey = scoreId ? encodeURIComponent(scoreId) : "";
  for (const key of ["candidate", "version", "source-version", "id"]) {
    if (values[key] && !uuid.test(values[key])) throw new Error(`--${key} 必须是 UUID。`);
  }
  if (command.startsWith("download-") && !values.out) throw new Error("下载必须指定 --out FILE。");
  if (command === "upload" && !values["source-version"]) throw new Error("上传必须指定 --source-version；先运行 status 核对来源 PDF。");
  const token = env.SAME_PAGE_TOKEN?.trim();
  if (!/^sp_cli_[0-9a-f]{64}$/.test(token ?? "")) throw new Error("请通过 SAME_PAGE_TOKEN 提供产品后台创建的 CLI 令牌。");
  const origin = originFrom(env.SAME_PAGE_URL || "https://samepage.clyapps.com");
  const api = async (path, init = {}) => {
    let response;
    try {
      response = await request(`${origin}/api/admin${path}`, {
        ...init, redirect: "error", signal: AbortSignal.timeout(60_000),
        headers: { ...init.headers, Authorization: `Bearer ${token}` },
      });
    } catch {
      throw new Error("请求失败或超时；检查网络和 SAME_PAGE_URL。上传重试应使用同一个 --id。");
    }
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const code = /^[a-z][a-z0-9_]{0,79}$/.test(body.error ?? "") ? body.error : "request_failed";
      const retry = response.status === 429 ? " 请按 Retry-After 稍后重试。" : "";
      throw new Error(`HTTP ${response.status}: ${code}.${retry}`);
    }
    return response;
  };
  const json = async (path) => (await api(path)).json();
  const detail = async () => json(`/scores/${scoreKey}${values.candidate ? `?selected=${values.candidate}` : ""}`);
  const output = (data) => {
    if (!values.json && command === "drives") {
      write(data.drives.map((d) => `${d.id}\t${d.name}`).join("\n"));
    } else if (!values.json && command === "scores") {
      write(data.scores.map((s) => `${s.id}\t${s.driveName}\t${s.fileName}`).join("\n"));
    } else write(JSON.stringify(data, null, values.json ? 0 : 2));
    return data;
  };
  if (command === "drives") return output(await json("/drives"));
  if (command === "scores") {
    const query = new URLSearchParams();
    if (values.drive) query.set("drive", values.drive);
    if (values.query) query.set("q", values.query);
    if (values.filter) query.set("filter", values.filter);
    const scores = [], seen = new Set();
    let page;
    do {
      page = await json(`/scores?${query}`);
      scores.push(...page.scores);
      if (page.next) {
        if (seen.has(page.next)) throw new Error("服务端返回重复分页游标，已停止读取。");
        seen.add(page.next);
        query.set("after", page.next);
      }
    } while (page.next);
    return output({ scores });
  }
  if (command === "status") return output(await detail());
  if (command === "upload") {
    const bytes = await readFile(file);
    const name = basename(file);
    if (!/\.(?:musicxml|xml|mxl)$/i.test(name) || bytes.length === 0 || bytes.length > 20 * 1024 * 1024) {
      throw new Error("候选必须是非空 XML/MusicXML/MXL，大小不超过 20 MiB。");
    }
    const id = values.id || randomUUID();
    warn(`候选 ID：${id}；如需重试，请使用 --id ${id}。`);
    const digest = sha256(bytes);
    const query = new URLSearchParams({
      name, size: String(bytes.length), sha256: digest,
      sourceVersionId: values["source-version"],
      tool: values.tool || "samepage-cli", parameters: values.parameters || "",
    });
    const result = await (await api(`/scores/${scoreKey}/candidates/${id}?${query}`, {
      method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: bytes,
    })).json();
    return output({ ...result, scoreId, sourceVersionId: values["source-version"], sha256: digest });
  }
  const current = await detail();
  let path, expectedSha, metadata;
  if (command === "download-pdf") {
    if (values.version && values.version !== current.score.versionId) throw new Error("来源 PDF 版本已变化；请重新读取 status，确认后下载。");
    const versionId = current.score.versionId;
    path = `/scores/${scoreKey}/pdf?versionId=${encodeURIComponent(versionId)}`;
    expectedSha = current.score.sha256;
    metadata = { sourceVersionId: versionId };
  } else if (values.candidate) {
    const candidate = current.selectedCandidate || current.candidates.find((c) => c.id === values.candidate);
    if (!candidate || candidate.id !== values.candidate || candidate.state !== "ready") throw new Error("候选不存在、未完成或已到期。");
    path = `/scores/${scoreKey}/candidates/${values.candidate}/file`;
    expectedSha = candidate.sha256;
    metadata = { candidateId: candidate.id, sourceVersionId: candidate.sourceVersionId };
  } else {
    if (!current.score.attachmentId || !current.score.attachmentRevision) throw new Error("该乐谱尚无正式练习版。");
    path = `/scores/${scoreKey}/published?revision=${current.score.attachmentRevision}`;
    metadata = { attachmentRevision: current.score.attachmentRevision, sourceVersionId: current.score.publishedSource };
  }
  const response = await api(path);
  const bytes = Buffer.from(await response.arrayBuffer()), digest = sha256(bytes);
  if (expectedSha && digest !== expectedSha) throw new Error("下载文件 SHA-256 与服务端记录不一致，未保存文件。");
  const outputPath = resolve(values.out);
  await saveFile(outputPath, bytes);
  return output({ scoreId, ...metadata, path: outputPath, sizeBytes: bytes.length, sha256: digest });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runCli(process.argv.slice(2)).catch((error) => {
    // Never print request headers, environment variables, or response bodies.
    const message = error instanceof Error ? error.message : "操作失败。";
    process.stderr.write(message + "\n");
    process.exitCode = 1;
  });
}
