import { useEffect, useRef, useState } from "react";
import { Button } from "react-aria-components";
import { LoadingStatus } from "../components/loading-status";
import {
  createCliToken,
  readAdminDrives,
  readCliTokens,
  revokeCliToken,
} from "./api";

type Token = Awaited<ReturnType<typeof readCliTokens>>["tokens"][number];
type Data = {
  tokens: Token[];
  drives: Awaited<ReturnType<typeof readAdminDrives>>["drives"];
  loadedAt: number;
};
const date = (value: number) => new Date(value).toLocaleString("zh-CN");

export function CliTokens({ canUpload, onError }: {
  canUpload: boolean;
  onError(error: unknown): void;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [upload, setUpload] = useState(false);
  const [driveIds, setDriveIds] = useState<string[]>([]);
  const [expiresInDays, setExpiresInDays] = useState(7);
  const [created, setCreated] = useState<Awaited<ReturnType<typeof createCliToken>> | null>(null);
  const [notice, setNotice] = useState("");
  const mutation = useRef<AbortController | null>(null);
  useEffect(() => () => mutation.current?.abort(), []);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([readCliTokens(controller.signal), readAdminDrives(controller.signal)])
      .then(([tokens, drives]) => {
        if (!controller.signal.aborted) setData({ tokens: tokens.tokens, drives: drives.drives, loadedAt: Date.now() });
      })
      .catch((cause) => {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "无法读取 CLI 令牌。");
          onError(cause);
        }
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [refresh, onError]);

  const create = async () => {
    if (!name.trim() || !driveIds.length || busy || !data) return;
    const controller = (mutation.current = new AbortController());
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await createCliToken({ name: name.trim(), canUpload: canUpload && upload, driveIds, expiresInDays }, controller.signal);
      if (controller.signal.aborted) return;
      setCreated(result);
      setData(current => current && ({ ...current, tokens: [result.credential, ...current.tokens] }));
      setName("");
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : "创建令牌失败，请重试。");
        onError(cause);
      }
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  };
  const revoke = async (token: Token) => {
    if (busy) return;
    const controller = (mutation.current = new AbortController());
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await revokeCliToken(token.id, controller.signal);
      if (controller.signal.aborted) return;
      setData(current => current && ({ ...current, tokens: current.tokens.map(item => item.id === token.id ? { ...item, revokedAt: Date.now() } : item) }));
      if (created?.credential.id === token.id) setCreated(null);
      setNotice(`已撤销「${token.name}」。`);
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : "撤销失败，请重试。");
        onError(cause);
      }
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  };
  return (
    <section aria-label="CLI 令牌" className="admin-cli-tokens">
      <h1 className="admin-title">CLI 令牌</h1>
      <p>为命令行选择可访问的云盘。令牌只能读取原 PDF、候选与正式练习版；允许上传后可导入候选。检查和发布仍在网页完成。</p>
      <Button className="secondary-button" isDisabled={busy || loading} onPress={() => { setLoading(true); setError(""); setRefresh(value => value + 1); }}>刷新令牌</Button>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {loading && <LoadingStatus>正在读取 CLI 令牌…</LoadingStatus>}
      {created && (
        <section className="admin-review admin-cli-secret" aria-label="新建令牌">
          <h2>「{created.credential.name}」已创建</h2>
          <p role="status">令牌只显示这一次。请现在保存；离开此页后无法再次查看。</p>
          <label className="admin-field">
            新建 CLI 令牌
            <input readOnly value={created.token} autoComplete="off" spellCheck={false} onFocus={event => event.currentTarget.select()} />
          </label>
          <p>在终端通过环境变量 SAME_PAGE_TOKEN 使用。不要将令牌提交到代码库。</p>
          <div className="admin-actions">
            <Button className="secondary-button" onPress={async () => {
              try {
                await navigator.clipboard.writeText(created.token);
                setNotice("令牌已复制。");
              } catch { setNotice("无法自动复制，请选中令牌后手动复制。"); }
            }}>复制令牌</Button>
            <Button className="secondary-button" onPress={() => { setCreated(null); setNotice(""); }}>关闭令牌显示</Button>
          </div>
        </section>
      )}
      {data && (
        <>
          <form className="admin-review" onSubmit={event => { event.preventDefault(); void create(); }}>
            <h2>创建令牌</h2>
            <fieldset disabled={busy || loading} className="admin-cli-fields">
              <label className="admin-field">名称<input value={name} maxLength={80} required onChange={event => setName(event.target.value)} placeholder="例如：本机转谱" /></label>
              <label className="admin-field">访问权限<select value={canUpload && upload ? "upload" : "read"} onChange={event => setUpload(event.target.value === "upload")}>
                <option value="read">只读</option>
                {canUpload && <option value="upload">允许上传候选</option>}
              </select></label>
              <label className="admin-field">有效期<select value={expiresInDays} onChange={event => setExpiresInDays(Number(event.target.value))}>
                <option value={7}>7 天</option><option value={30}>30 天</option>
              </select></label>
              <fieldset className="admin-cli-drives">
                <legend>可访问的云盘（至少选择一个）</legend>
                {data.drives.length ? data.drives.map(drive => (
                  <label key={drive.id}><input type="checkbox" checked={driveIds.includes(drive.id)} onChange={event => setDriveIds(current => event.target.checked ? [...current, drive.id] : current.filter(id => id !== drive.id))} />{drive.name}</label>
                )) : <p>当前没有已启用的运营云盘。</p>}
              </fieldset>
              <Button className="primary-button" type="submit" isDisabled={busy || loading || !name.trim() || !driveIds.length}>{busy ? "正在处理…" : "创建令牌"}</Button>
            </fieldset>
          </form>
          <h2>现有令牌</h2>
          {data.tokens.length ? (
            <div className="admin-table"><table aria-label="现有 CLI 令牌"><thead><tr><th>名称与权限</th><th>云盘</th><th>到期时间</th><th>状态</th></tr></thead><tbody>
              {data.tokens.map(token => <tr key={token.id}>
                <td>{token.name}<small>{token.canUpload ? "允许上传候选" : "只读"}</small></td>
                <td>{token.driveIds.map(id => data.drives.find(drive => drive.id === id)?.name ?? "已停用的云盘").join("、")}</td>
                <td>{date(token.expiresAt)}</td>
                <td>{token.revokedAt ? "已撤销" : token.expiresAt <= data.loadedAt ? "已到期" : <Button className="secondary-button" isDisabled={busy || loading} onPress={() => void revoke(token)} aria-label={`撤销 ${token.name}`}>撤销</Button>}</td>
              </tr>)}
            </tbody></table></div>
          ) : <p>还没有 CLI 令牌。</p>}
        </>
      )}
    </section>
  );
}
