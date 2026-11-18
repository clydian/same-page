import { useMessages } from "../../i18n";
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
  const t = useMessages("library");
  const { directory, rows, failed, knownEmpty, localFailure } = membership;
  return <>
    <div className="membership-status" role="status">{failed && <>{t("membershipListAddedCloudDiskCannot")}<Button onPress={() => void directory.refresh().catch(() => undefined)}>{t("retry")}</Button></>}</div>
    {rows.length > 0 && <div className="membership-list">{rows.map(row => {
      const current = row.choir.id === currentChoirId;
      const content = <span><strong title={row.choir.name}>{row.choir.name}</strong><small>{row.isOwner === null ? t("membershipListIdentityConfirmed") : row.isOwner ? t("owner") : t("member")}{current ? t("membershipListCurrentCloudDisk") : ""}{row.unavailable ? t("membershipListNoLongerAvailable") : ""}</small></span>;
      return row.unavailable ? <span className="membership-row" role="link" aria-disabled="true" key={row.choir.id}>{content}</span>
        : <Link className="membership-row" key={row.choir.id} replace={replace || Boolean(currentChoirId)} to={`/choirs/${row.choir.id}`} aria-current={current ? "page" : undefined} onClick={event => {
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          if (current) event.preventDefault();
          startLoadingJourney("enter-drive", "warm"); onSelect?.();
        }}>{content}<span aria-hidden="true">→</span></Link>;
    })}</div>}
    {!rows.length && (localFailure && directory.data === null ? <p role="status">{t("membershipList")}</p>
      : knownEmpty ? <p className="membership-empty">{localOnly ? t("membershipList2") : t("membershipListThereNoCloudDisks")}</p>
      : !failed && <p role="status">{localOnly ? t("localLibraryReadingLocalDirectory") : t("membershipListLoadingAddedCloudDisk")}</p>)}
  </>;
}
