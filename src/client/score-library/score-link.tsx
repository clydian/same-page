import { useMessages } from "../../i18n";
import { readerHref } from "../reader/reader-entry";
import { useLiveQuery } from "dexie-react-hooks";
import { useMemo, type ReactNode, type MouseEvent } from "react";
import { FileOpenLink } from "./file-open-link";
import { useOfflineScore } from "../offline/use-offline-score";
import { experienceOwnerKey, authenticatedLocalOwnerKey, createLocalWorkspace, currentLocalOwnerKey } from "../platform/local-workspace";

export function ScoreLink({ userId, choirId, scoreId, local, experience = false, explainUnavailable = true, label, description, children, onOpen, onClick, onLongPress }: {
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
  onLongPress?: () => void;
  explainUnavailable?: boolean; label: string; description: string; experience?: boolean; userId?: string; choirId: string; scoreId: string; local: boolean; children: ReactNode; onOpen: () => void;
}) {
  const t = useMessages("library");
  const guestOwner = useLiveQuery(async () => {
    if (userId || !local) return null;
    const owner = await currentLocalOwnerKey();
    return owner?.startsWith("guest:") ? owner : null;
  }, [userId, local]);
  const owner = userId ? authenticatedLocalOwnerKey(userId) : guestOwner;
  const workspace = useMemo(() => owner && local ? createLocalWorkspace(experience ? experienceOwnerKey(owner) : owner, choirId, scoreId) : null, [owner, choirId, scoreId, local, experience]);
  const offline = useOfflineScore(workspace);
  const ready = offline?.scopeKey === workspace?.scopeKey && offline?.record && !offline.invalid;
  const inspected = Boolean(workspace && offline?.scopeKey === workspace.scopeKey);
  const unavailable = local && !ready
    ? inspected ? offline?.readFailed ? t("scoreLinkLocalCopyCannotVerified") : t("localLibraryNoOfflineCopyAvailable") : t("scoreLinkConfirmingHowOpen")
    : undefined;
  return <FileOpenLink aria-label={label} aria-description={unavailable ? `${description}，${unavailable}` : description} className="file-row__open"
    to={readerHref({ choirId, scoreId, experience })} unavailable={unavailable} onLongPress={onLongPress}
    onClick={event => { onClick?.(event); if (!event.defaultPrevented) onOpen(); }}>
    {children}{unavailable && explainUnavailable && <span className="file-row__unavailable">{unavailable}</span>}
  </FileOpenLink>;
}
