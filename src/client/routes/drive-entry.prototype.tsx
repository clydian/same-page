// THROWAWAY: three structurally different /drives entries, ?variant=A|B|C.
// Example states and join/create actions stay in memory; never ship this branch.
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, ChevronDown, ChevronRight, FolderOpen, KeyRound, Plus, X } from "lucide-react";
import { AppHeader } from "../components/app-header";
import { PersonalMenu } from "../components/personal-menu";
import type { ApplicationIdentity } from "../auth/application-identity";
import { IdentityNotice } from "../auth/local-entry";
import { ChoirLibrary } from "./choir-page";
import { driveCacheOwnerKey } from "../score-library/drive-library-cache";
import { useReadResource } from "../settings/use-read-resource";
import { loadMembershipDirectory, membershipDirectoryKey, membershipFreshMs, restoreMembershipDirectory } from "../score-library/membership-directory";
import "./drive-entry.prototype.css";

const variants = ["A", "B", "C"];
const names = ["轻量选择", "继续排练", "直接进入"];
const cases = { current: "当前示例用户", empty: "尚未加入云盘", single: "只有一个云盘", multiple: "多个云盘 · 有上次记录", offline: "离线 · 有本机目录", missing: "上次云盘已不可用" };
type Scenario = keyof typeof cases;
type Row = { id: string; name: string; owner: boolean; recent?: boolean };

export function DriveEntryPrototype({ identity }: { identity: ApplicationIdentity }) {
  const [params, setParams] = useSearchParams();
  const variant = variants.includes(params.get("variant") ?? "") ? params.get("variant")! : "C";
  const scenarioParam = params.get("case") ?? "current";
  const scenario = (scenarioParam in cases ? scenarioParam : "current") as Scenario;
  const userId = identity.authenticatedUserId ?? identity.localUserId ?? "prototype";
  const directory = useReadResource(membershipDirectoryKey(userId), signal => loadMembershipDirectory(userId, signal), () => restoreMembershipDirectory(userId), membershipFreshMs, Boolean(identity.authenticatedUserId));
  const { refresh } = directory;
  useEffect(() => { void refresh().catch(() => undefined); }, [scenario, refresh]);
  const real = (directory.data ?? []).map(row => ({ id: row.choir.id, name: row.choir.name, owner: Boolean(row.isOwner) }));
  const sample = real.find(row => row.id === "visual-choir") ?? { id: "visual-choir", name: "小红花云盘", owner: true };
  const examples: Row[] = [{ ...sample, recent: true }, { id: "prototype-weekend", name: "周末合唱团", owner: false }, { id: "prototype-spring", name: "春季音乐会", owner: false }];
  const baseRows = scenario === "current" ? real : scenario === "empty" ? [] : scenario === "single" ? [examples[0]] : scenario === "missing" ? examples.slice(1) : examples;
  const [added, setAdded] = useState<Row[]>([]);
  const rows = [...baseRows, ...added];
  const [entered, setEntered] = useState<Row | null>(null);
  const [action, setAction] = useState<"join" | "create" | null>(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [expanded, setExpanded] = useState(false);
  const offline = scenario === "offline";
  const libraryIdentity: ApplicationIdentity = offline ? { ...identity, onlineState: "unreachable", authenticatedUserId: null, authenticatedSessionId: null } : identity;
  const change = (key: string, value: string) => { const next = new URLSearchParams(params); next.set(key, value); setParams(next, { replace: true }); setEntered(null); setAdded([]); setAction(null); setExpanded(false); };
  const cycle = (step: number) => change("variant", variants[(variants.indexOf(variant) + step + 3) % 3]);
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.defaultPrevented || event.target instanceof HTMLElement && (event.target.closest("input,textarea,select,button,a,[role=dialog],[contenteditable=true]"))) return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); cycle(event.key === "ArrowLeft" ? -1 : 1); }
    };
    window.addEventListener("keydown", keys); return () => window.removeEventListener("keydown", keys);
  });
  const rowList = (list: Row[]) => <div className="entry-proto-list">{list.map(row => <button key={row.id} onClick={() => setEntered(row)}><FolderOpen size={20} /><span><strong>{row.name}</strong><small>{row.owner ? "拥有者" : "成员"}{offline ? " · 本机目录" : ""}</small></span><ChevronRight size={18} /></button>)}</div>;
  const actions = <div className="entry-proto-actions"><button className="text-button" disabled={offline} onClick={() => setAction("join")}><Plus size={16} />加入云盘</button><span aria-hidden="true">·</span><button className="text-button" disabled={offline} onClick={() => setAction("create")}>创建云盘</button></div>;
  const welcome = (inline: boolean) => <section className={`entry-proto-welcome ${inline ? "entry-proto-welcome-inline" : ""}`}>
    <div className="entry-proto-symbol"><KeyRound size={27} strokeWidth={1.5} /></div><p className="entry-proto-overline">开始使用合谱</p><h1>先加入你的云盘</h1><p>向云盘成员索取邀请码，<br />在同一份乐谱上开始排练。</p>
    {inline ? <form onSubmit={event => { event.preventDefault(); setAdded([{ id: "prototype-new", name: "春季排练云盘", owner: false }]); }}><label htmlFor="entry-invite">云盘邀请码</label><input id="entry-invite" required minLength={8} placeholder="输入 8 位邀请码" maxLength={8} value={code} onChange={event => setCode(event.target.value.toUpperCase())} autoComplete="off" /><button className="primary-button" type="submit">加入云盘<ArrowRight size={17} /></button></form> : <button className="primary-button" onClick={() => setAction("join")}>使用邀请码加入<ArrowRight size={17} /></button>}
    <div className="entry-proto-new"><p>想组织自己的排练？</p><button className="text-button" onClick={() => setAction("create")}>创建一个云盘<ChevronRight size={15} /></button></div>
  </section>;
  const canContinue = rows.length > 0 && scenario !== "missing" && (scenario !== "current" || rows.length === 1);
  const showLibrary = entered || variant === "C" && canContinue ? entered ?? rows[0] : null;
  return <div className="entry-proto">
    {showLibrary ? <>
      {showLibrary.id !== "prototype-new" ? <ChoirLibrary key={showLibrary.id} choirId={showLibrary.id} identity={libraryIdentity} cacheOwner={driveCacheOwnerKey(identity.localUserId, showLibrary.id)} /> : <><AppHeader actions={<PersonalMenu email={identity.session.data?.user.email} />} /><main className="entry-proto-selected"><button className="entry-proto-switch" onClick={() => { setEntered(null); change("variant", "A"); }}>{showLibrary.name}<ChevronDown size={18} /></button><p>乐谱</p><h1>从第一份乐谱开始</h1><p>这里还没有乐谱。</p></main></>}
    </> : <>
      <AppHeader actions={<PersonalMenu email={identity.session.data?.user.email} />} />
      <main className={`entry-proto-main entry-proto-${variant.toLowerCase()}`}>
        <IdentityNotice identity={identity} />
        {scenario === "missing" && <p className="entry-proto-offline" role="status">上次的云盘已不可用，请选择其他云盘。</p>}
        {offline && <p className="entry-proto-offline" role="status">当前离线。可以打开本机已保存的内容，联网后可加入或创建云盘。</p>}
        {scenario === "current" && directory.data === null && !directory.error ? <p role="status">正在读取云盘…</p> : !rows.length ? welcome(variant !== "A") : variant === "A" || variant === "C" || scenario === "missing" ? <>
          <p className="entry-proto-overline">合谱 · 排练入口</p><h1>选择云盘</h1><p className="entry-proto-subtitle">打开乐谱，继续排练。</p>{rowList(rows)}{actions}
        </> : <>
          <p className="entry-proto-overline">欢迎回来</p><h1>继续排练</h1>
          <section className="entry-proto-continue"><span className="entry-proto-continue-icon"><FolderOpen size={30} strokeWidth={1.5} /></span><div><p>上次打开</p><h2>{rows[0].name}</h2><small>{rows[0].owner ? "拥有者" : "成员"}</small></div><button className="primary-button" onClick={() => setEntered(rows[0])}>打开云盘<ArrowRight size={18} /></button></section>
          {rows.length > 1 && <><button className="entry-proto-other" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>其他云盘<span>{rows.length - 1}<ChevronDown size={17} /></span></button>{expanded && rowList(rows.slice(1))}</>}
          {actions}
        </>}
      </main>
    </>}
    {action && <div className="entry-proto-overlay" onClick={() => setAction(null)}><section role="dialog" aria-modal="true" aria-labelledby="entry-proto-dialog-title" className="entry-proto-dialog" onClick={event => event.stopPropagation()}><button className="icon-button entry-proto-close" aria-label="关闭" onClick={() => setAction(null)}><X size={20} /></button><h2 id="entry-proto-dialog-title">{action === "join" ? "加入云盘" : "创建免费体验云盘"}</h2><p>{action === "join" ? "输入云盘成员分享给你的邀请码。" : "用于你组织的排练，可邀请其他成员一起使用。"}</p><form onSubmit={event => { event.preventDefault(); setAdded([{ id: "prototype-new", name: action === "join" ? "春季排练云盘" : name, owner: action === "create" }]); setAction(null); }}><label htmlFor="entry-proto-field">{action === "join" ? "云盘邀请码" : "云盘名称"}</label><input id="entry-proto-field" required autoFocus maxLength={action === "join" ? 8 : 100} value={action === "join" ? code : name} onChange={event => action === "join" ? setCode(event.target.value.toUpperCase()) : setName(event.target.value)} placeholder={action === "join" ? "例如 ABCD1234" : "例如 春季音乐会"} /><button className="primary-button" type="submit">{action === "join" ? "加入云盘" : "创建云盘"}</button></form><p className="entry-proto-note">仅演示交互，不创建或加入真实云盘。</p></section></div>}
    {import.meta.env.DEV && <aside className="entry-proto-toolbar" aria-label="设计预览控制"><span>设计预览 · 示例数据</span><div className="entry-proto-variants"><button aria-label="上一个方案" onClick={() => cycle(-1)}><ArrowLeft size={16} /></button><strong>{variant} · {names[variants.indexOf(variant)]}</strong><button aria-label="下一个方案" onClick={() => cycle(1)}><ArrowRight size={16} /></button></div><select aria-label="预览用户状态" value={scenario} onChange={event => change("case", event.target.value)}>{Object.entries(cases).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><small aria-live="polite">{showLibrary ? `已进入：${showLibrary.name}` : `${rows.length} 个云盘`}{offline ? " · 离线示意" : ""}</small></aside>}
  </div>;
}
