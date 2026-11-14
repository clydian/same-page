import "./local-entry.css";
import { Link } from "react-router-dom";
import type { ApplicationIdentity } from "./application-identity";

export function IdentityNotice({ identity }: { identity: ApplicationIdentity }) {
  if (identity.onlineState === "authenticated" || (!identity.localUserId && identity.onlineState === "signed-out")) return null;
  return <p role="status">{identity.onlineState === "checking" ? "正在连接，已保存的内容可以继续使用。"
    : identity.onlineState === "local-unavailable" ? "本机身份校验暂时未完成，已保存的内容仍然保留。"
    : identity.onlineState === "unreachable" ? "暂时无法连接，已保存的内容仍然保留。"
    : "重新登录后同步，已保存的内容可以继续使用。"}
    {identity.onlineState === "signed-out" ? <> <Link to="/login">重新登录</Link></> : null}
    {identity.onlineState === "unreachable" || identity.onlineState === "local-unavailable" ? <> <button className="text-button" disabled={identity.session.isRefetching} onClick={() => void identity.session.refetch()}>{identity.session.isRefetching ? "正在重试…" : identity.onlineState === "local-unavailable" ? "重试校验" : "重试连接"}</button></> : null}
  </p>;
}
