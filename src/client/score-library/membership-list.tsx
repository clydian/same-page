import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "react-aria-components";
import { Link } from "react-router-dom";
import { startLoadingJourney } from "../performance/loading-performance";
import { getReadResource } from "../settings/read-resource";
import { useReadResource } from "../settings/use-read-resource";
import { membershipDirectoryRevision, onMembershipDirectoryChange } from "../settings/navigation-events";
import { loadMembershipDirectory, membershipDirectoryKey, membershipFreshMs, reconcileMembershipRows, restoreMembershipDirectory, type MembershipEntry } from "./membership-directory";
import "./library-ux.css";

type Rows = ReturnType<typeof reconcileMembershipRows>;
export function MembershipList({ userId, currentChoirId, onSelect, localOnly = false }: {
  userId: string; currentChoirId?: string; onSelect?: () => void; localOnly?: boolean;
}) {
  const [localFailure, setLocalFailure] = useState<string | null>(null);
  const resource = getReadResource<MembershipEntry[]>(membershipDirectoryKey(userId));
  useEffect(() => { if (localOnly) resource.invalidate(); }, [localOnly, resource]);
  const directory = useReadResource(membershipDirectoryKey(userId), signal => loadMembershipDirectory(userId, signal), async () => {
    try { return await restoreMembershipDirectory(userId); }
    catch { setLocalFailure(userId); return null; }
  }, membershipFreshMs, !localOnly);
  const revision = useSyncExternalStore(onMembershipDirectoryChange, membershipDirectoryRevision);
  const seenRevision = useRef(revision);
  const { refresh } = directory;
  useEffect(() => {
    if (seenRevision.current === revision) return;
    seenRevision.current = revision;
    if (!localOnly) void refresh().catch(() => undefined);
  }, [revision, localOnly, refresh]);
  const [presentation, setPresentation] = useState<{ userId: string; data: MembershipEntry[] | null; rows: Rows }>({ userId, data: null, rows: [] });
  let rows = presentation.rows;
  if (presentation.userId !== userId || presentation.data !== directory.data) {
    rows = reconcileMembershipRows(presentation.userId === userId ? presentation.rows : [], directory.data ?? []);
    setPresentation({ userId, data: directory.data, rows });
  }
  // Endpoint denial clears protected presentation; temporary failures retain it.
  if (directory.authority === "signed-out" || directory.authority === "revoked") rows = [];
  const failed = Boolean(directory.error) && !localOnly;
  const knownEmpty = directory.data !== null && !directory.data.length && (localOnly || directory.authority === "confirmed");
  if (knownEmpty) rows = [];
  return <>
    <div className="membership-status" role="status">{failed && <>暂时无法加载已加入的云盘。<Button onPress={() => void directory.refresh().catch(() => undefined)}>重试</Button></>}</div>
    {rows.length > 0 && <div className="membership-list">{rows.map(row => {
      const current = row.choir.id === currentChoirId;
      const content = <span><strong title={row.choir.name}>{row.choir.name}</strong><small>{row.isOwner === null ? "身份待确认" : row.isOwner ? "拥有者" : "成员"}{current ? " · 当前云盘" : ""}{row.unavailable ? " · 已不可用" : ""}</small></span>;
      return row.unavailable ? <span className="membership-row" role="link" aria-disabled="true" key={row.choir.id}>{content}</span>
        : <Link className="membership-row" key={row.choir.id} replace={Boolean(currentChoirId)} to={`/choirs/${row.choir.id}`} aria-current={current ? "page" : undefined} onClick={event => {
          if (current) event.preventDefault();
          startLoadingJourney("enter-drive", "warm"); onSelect?.();
        }}>{content}<span aria-hidden="true">→</span></Link>;
    })}</div>}
    {!rows.length && (localFailure === userId && directory.data === null ? <p role="status">暂时无法读取本机目录，请重试连接。</p>
      : knownEmpty ? <p className="membership-empty">{localOnly ? "本机尚未保存云盘目录，请联网后重试。" : "还没有已加入的云盘。请使用云盘提供的邀请码加入。"}</p>
      : !failed && <p role="status">{localOnly ? "正在读取本机目录…" : "正在加载已加入的云盘…"}</p>)}
  </>;
}
