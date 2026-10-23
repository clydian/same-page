import { Button } from "react-aria-components";
import { Link } from "react-router-dom";
import { startLoadingJourney } from "../performance/loading-performance";
import { useMembershipDirectory } from "./use-membership-directory";
import "./library-ux.css";

type ListProps = { userId: string; currentChoirId?: string; onSelect?: () => void; localOnly?: boolean; replace?: boolean };

export function MembershipList({ userId, localOnly = false, ...props }: ListProps) {
  const membership = useMembershipDirectory(userId, localOnly);
  return <MembershipDirectoryList membership={membership} localOnly={localOnly} {...props} />;
}

export function MembershipDirectoryList({ membership, currentChoirId, onSelect, localOnly = false, replace = false }: Omit<ListProps, "userId"> & { membership: ReturnType<typeof useMembershipDirectory> }) {
  const { directory, rows, failed, knownEmpty, localFailure } = membership;
  return <>
    <div className="membership-status" role="status">{failed && <>暂时无法加载已加入的云盘。<Button onPress={() => void directory.refresh().catch(() => undefined)}>重试</Button></>}</div>
    {rows.length > 0 && <div className="membership-list">{rows.map(row => {
      const current = row.choir.id === currentChoirId;
      const content = <span><strong title={row.choir.name}>{row.choir.name}</strong><small>{row.isOwner === null ? "身份待确认" : row.isOwner ? "拥有者" : "成员"}{current ? " · 当前云盘" : ""}{row.unavailable ? " · 已不可用" : ""}</small></span>;
      return row.unavailable ? <span className="membership-row" role="link" aria-disabled="true" key={row.choir.id}>{content}</span>
        : <Link className="membership-row" key={row.choir.id} replace={replace || Boolean(currentChoirId)} to={`/choirs/${row.choir.id}`} aria-current={current ? "page" : undefined} onClick={event => {
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          if (current) event.preventDefault();
          startLoadingJourney("enter-drive", "warm"); onSelect?.();
        }}>{content}<span aria-hidden="true">→</span></Link>;
    })}</div>}
    {!rows.length && (localFailure && directory.data === null ? <p role="status">暂时无法读取本机目录，请重试连接。</p>
      : knownEmpty ? <p className="membership-empty">{localOnly ? "本机尚未保存云盘目录，请联网后重试。" : "还没有已加入的云盘。请使用云盘提供的邀请码加入。"}</p>
      : !failed && <p role="status">{localOnly ? "正在读取本机目录…" : "正在加载已加入的云盘…"}</p>)}
  </>;
}
