import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { adminFetch, AdminRequestError } from "./api";
import { ConfirmDialog } from "../settings/confirm-dialog";
const schema = z.object({ stable: z.string(), beta: z.string(), revision: z.number(), releases: z.array(z.object({ buildId: z.string(), publishedAt: z.number(), version: z.string().nullable().optional() })), events: z.array(z.object({ id: z.string(), previousStable: z.string(), target: z.string(), createdAt: z.number() })), storageCompatible: z.boolean().optional(), verification: z.object({ buildId: z.string(), status: z.enum(['running', 'success', 'failure', 'cancelled']), updatedAt: z.number(), runId: z.number().int().positive() }).nullable().optional() });
const dateFormat = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Shanghai" });
export function Releases({ onError }: { onError(error: unknown): void }) {
  const [data, setData] = useState<z.infer<typeof schema> | null>(null);
  const [busy, setBusy] = useState<"refresh" | "promote" | null>("refresh");
  const [message, setMessage] = useState("正在读取发布通道…"), [error, setError] = useState("");
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [confirmPromote, setConfirmPromote] = useState(false);
  const request = useRef<{ id: string; expectedBeta: string; expectedRevision: number } | null>(null);
  const version = (id: string) => data?.releases.find(release => release.buildId === id)?.version ?? "版本号未记录";
  const verification = data && data.verification?.buildId === data.beta ? data.verification : null;
  const verificationStatus = verification ? { running: '进行中', success: '通过', failure: '失败', cancelled: '已取消' }[verification.status] : '暂无结果或暂不可用';
  const report = useCallback((error: unknown) => {
    setError(error instanceof Error ? error.message : "操作未完成，请重试。");
    onError(error);
  }, [onError]);
  const load = useCallback(async () => { const next = schema.parse(await (await adminFetch("/releases")).json()); setData(next); }, []);
  useEffect(() => {
    const abort = new AbortController();
    void adminFetch("/releases", { signal: abort.signal }).then(response => response.json()).then(value => {
      if (!abort.signal.aborted) { setData(schema.parse(value)); setMessage(""); }
    }).catch(error => { if (!abort.signal.aborted) { setMessage(""); report(error); } })
      .finally(() => { if (!abort.signal.aborted) setBusy(null); });
    return () => abort.abort();
  }, [report]);
  async function refresh() {
    setBusy("refresh"); setError(""); setMessage("正在读取发布通道…");
    try {
      await load(); request.current = null; setNeedsRefresh(false); setMessage("版本信息已更新。");
    } catch (error) { setMessage(""); report(error); }
    finally { setBusy(null); }
  }
  async function promote() {
    if (!data || busy || needsRefresh) return;
    const targetVersion = version(data.beta);
    setBusy("promote"); setError(""); setMessage(`正在将 ${targetVersion} 设为稳定版…`);
    request.current ??= { id: crypto.randomUUID(), expectedBeta: data.beta, expectedRevision: data.revision };
    let submitted = false;
    try {
      await adminFetch("/releases/promote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request.current) });
      submitted = true; request.current = null;
      await load(); setMessage(`已将 ${targetVersion} 设为稳定版。`);
    } catch (error) {
      if (submitted || error instanceof AdminRequestError && error.status === 409) setNeedsRefresh(true);
      setMessage(submitted ? "提升已提交，请重新读取版本确认结果。" : "");
      report(error);
    } finally { setBusy(null); }
  }
  return <section className="release-admin" aria-labelledby="release-admin-heading">
    <header className="release-admin-heading">
      <h1 className="admin-title" id="release-admin-heading">发布通道</h1>
      <p>先在测试版确认体验，再向默认用户发布。</p>
    </header>
    {data && <>
      <table className="release-admin-table">
        <caption className="release-admin-caption">发布时间采用北京时间</caption>
        <thead><tr><th scope="col">通道</th><th scope="col">当前版本</th><th scope="col">发布时间</th></tr></thead>
        <tbody>{([['stable', '稳定版', '默认用户'], ['beta', '测试版', '主动体验用户']] as const).map(([channel, name, audience]) => {
          const id = data[channel], release = data.releases.find(release => release.buildId === id);
          return <tr key={channel}>
            <th scope="row">{name}<small>{audience}</small></th>
            <td><span className="release-version" translate="no">{version(id)}</span>{channel === 'beta' && data.beta === data.stable && <small>与稳定版相同</small>}</td>
            <td>{release ? <time dateTime={new Date(release.publishedAt).toISOString()}>{dateFormat.format(release.publishedAt)}</time> : '暂无记录'}</td>
          </tr>;
        })}</tbody>
      </table>
      <section className="release-admin-verification" aria-labelledby="release-verification-heading">
        <h2 id="release-verification-heading">当前测试版的验证</h2>
        <p>发布前所选 CI 检查：<strong>{verification ? '通过' : '暂无记录'}</strong></p>
        {data.beta !== data.stable && <p>与当前稳定版的存储兼容检查：<strong>{data.storageCompatible ? '通过' : '暂未确认'}</strong>（提升时必须通过）</p>}
        <p>发布后的扩展浏览器检查（最近记录）：<strong>{verificationStatus}</strong></p>
        <p>扩展检查不阻止测试版发布，也不能代替真实设备体验；失败或缺少结果时请先调查。</p>
        {verification && <p>更新时间：<time dateTime={new Date(verification.updatedAt).toISOString()}>{dateFormat.format(verification.updatedAt)}</time> · <a href={`https://github.com/clydian/same-page/actions/runs/${verification.runId}`} target="_blank" rel="noreferrer">查看运行详情</a></p>}
      </section>
      <details className="release-admin-details"><summary>技术详情 · 构建标识</summary><dl>
        {data.releases.map(release => <Fragment key={release.buildId}><dt>{release.buildId === data.stable ? "稳定版 · " : release.buildId === data.beta ? "测试版 · " : "历史版本 · "}<span translate="no">{version(release.buildId)}</span></dt><dd><code translate="no">{release.buildId}</code></dd></Fragment>)}
      </dl></details>
    </>}
    <div className="admin-actions release-admin-actions">
      {data && <button className="primary-button" disabled={!!busy || needsRefresh || data.beta === data.stable} onClick={() => setConfirmPromote(true)}>
        {busy === "promote" ? "正在设为稳定版…" : data.releases.find(release => release.buildId === data.beta)?.version ? `将 ${version(data.beta)} 设为稳定版` : "将当前测试版设为稳定版"}
      </button>}
      <button className="secondary-button" disabled={!!busy} onClick={() => void refresh()}>{busy === "refresh" ? "正在读取…" : "重新读取版本"}</button>
    </div>
    <p className="release-admin-status" role="status" aria-live="polite">{message}</p>
    {error && <p role="alert">{error}</p>}
    {data && <section className="release-admin-history" aria-labelledby="release-admin-history-heading">
      <h2 id="release-admin-history-heading">提升记录</h2>
      {data.events.length ? <ul>{data.events.map(event => <li key={event.id}>
        <span><span className="release-version" translate="no">{version(event.previousStable)}</span><span aria-label="提升为"> → </span><span className="release-version" translate="no">{version(event.target)}</span></span>
        <time dateTime={new Date(event.createdAt).toISOString()}>{dateFormat.format(event.createdAt)}</time>
      </li>)}</ul> : <p>还没有提升记录。</p>}
    </section>}
    <ConfirmDialog busy={!!busy} onClose={() => setConfirmPromote(false)} confirmation={confirmPromote && data ? {
      title: "将测试版设为稳定版？",
      message: <><p>稳定版将从 <span translate="no">{version(data.stable)}</span> 更新到 <span translate="no">{version(data.beta)}</span>。</p><p>扩展浏览器检查：{verificationStatus}。请确认测试版体验。</p><p>稳定版用户将在安全更新时机收到此版本。</p></>,
      action: "确认设为稳定版", onConfirm: promote,
    } : null} />
  </section>;
}
