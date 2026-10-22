import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { adminFetch } from "./api";
const schema = z.object({ stable: z.string(), beta: z.string(), revision: z.number(), releases: z.array(z.object({ buildId: z.string(), publishedAt: z.number() })), events: z.array(z.object({ id: z.string(), previousStable: z.string(), target: z.string(), createdAt: z.number() })) });
export function Releases({ onError }: { onError(error: unknown): void }) {
  const [data, setData] = useState<z.infer<typeof schema> | null>(null), [busy, setBusy] = useState(false);
  const request = useRef<{ id: string; expectedBeta: string; expectedRevision: number } | null>(null);
  const load = useCallback(async () => { const next = schema.parse(await (await adminFetch("/releases")).json()); setData(next); }, []);
  useEffect(() => { const abort = new AbortController(); void adminFetch("/releases", {signal:abort.signal}).then(r=>r.json()).then(v=>{if(!abort.signal.aborted)setData(schema.parse(v));}).catch(e=>{if(!abort.signal.aborted)onError(e);}); return ()=>abort.abort(); }, [onError]);
  async function promote() {
    if (!data) return;
    setBusy(true);
    request.current ??= { id: crypto.randomUUID(), expectedBeta: data.beta, expectedRevision: data.revision };
    try {
      await adminFetch("/releases/promote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request.current) });
      request.current = null; await load();
    } catch (e) { onError(e); }
    finally { setBusy(false); }
  }
  return <section><h1>发布通道</h1>{data ? <>
    <p>稳定版 <code>{data.stable}</code></p><p>测试版 <code>{data.beta}</code></p>
    {data.releases.map(r => <p key={r.buildId}><code>{r.buildId.slice(0, 7)}</code> · {new Date(r.publishedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</p>)}
    <button disabled={busy || data.beta === data.stable} onClick={() => void promote()}>将 {data.beta.slice(0, 7)} 设为稳定版</button>
    <button disabled={busy} onClick={() => { request.current = null; void load().catch(onError); }}>重新读取版本</button>
    <h2>提升记录</h2>{data.events.map(e => <p key={e.id}>{e.previousStable.slice(0, 7)} → {e.target.slice(0, 7)} · {new Date(e.createdAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</p>)}
  </> : <p>正在读取发布版本…</p>}</section>;
}
