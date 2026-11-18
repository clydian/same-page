import { useMessages } from "../../i18n";
import "./local-entry.css";
import { Link } from "react-router-dom";
import type { ApplicationIdentity } from "./application-identity";

export function IdentityNotice({ identity }: { identity: ApplicationIdentity }) {
  const t = useMessages("entry");
  if (identity.onlineState === "authenticated" || (!identity.localUserId && identity.onlineState === "signed-out")) return null;
  return <p role="status">{identity.onlineState === "checking" ? t("identity.checking")
    : identity.onlineState === "local-unavailable" ? t("identity.localUnavailable")
    : identity.onlineState === "unreachable" ? t("identity.unreachable")
    : t("identity.signedOut")}
    {identity.onlineState === "signed-out" ? <> <Link to="/login">{t("identity.loginAgain")}</Link></> : null}
    {identity.onlineState === "unreachable" || identity.onlineState === "local-unavailable" ? <> <button className="text-button" disabled={identity.session.isRefetching} onClick={() => void identity.session.refetch()}>{identity.session.isRefetching ? t("identity.retrying") : identity.onlineState === "local-unavailable" ? t("identity.retryVerify") : t("identity.retryConnection")}</button></> : null}
  </p>;
}
