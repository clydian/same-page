import { useMessages } from "../../i18n";
import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { Button, DialogTrigger, Heading, Modal, ModalOverlay, Popover } from "react-aria-components";
import { ChevronDown, Plus, X } from "lucide-react";
import { Dialog } from "../navigation/overlays";
import { useCompactLayout } from "../platform/use-compact-layout";
import { MembershipDirectoryList } from "./membership-list";
import { useMembershipDirectory } from "./use-membership-directory";
import { CreateDriveDialog } from "../drives/create-drive";
import { JoinDriveDialog } from "../drives/join-drive-dialog";
import { useApplicationIdentity } from "../auth/application-identity";
import { loginHref } from "../auth/login-return";

export function DriveSwitcher({ choirId, choirName, userId, localOnly, loading }: {
  choirId: string; choirName: string; userId?: string; localOnly: boolean; loading: boolean;
}) {
  const t = useMessages("library");
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState<"join" | "create" | null>(null);
  const [returnAction, setReturnAction] = useState<"join" | "create" | null>(null);
  const libraryPosition = useRef({ left: 0, top: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const identity = useApplicationIdentity();
  const closeAction = () => {
    setAction(null);
    requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
  };
  const restoreLibraryPosition = () => {
    if (triggerRef.current?.isConnected) window.scrollTo({ ...libraryPosition.current, behavior: "instant" });
  };
  const returnToPicker = () => {
    setReturnAction(action);
    setAction(null);
    setOpen(true);
    requestAnimationFrame(restoreLibraryPosition);
  };
  const narrow = useCompactLayout();
  const content = <Dialog className="drive-switch-content" aria-label={t("driveSwitcherSwitchCloudDisk")} data-no-native-selection>{({ close }) => <>
    <div className="dialog-heading"><Heading slot="title">{t("driveSwitcherSwitchCloudDisk")}</Heading><Button className="icon-button" aria-label={t("driveSwitcherCloseCloudDiskSelection")} onPress={close}><X size={21} aria-hidden="true" /></Button></div>
    {localOnly && userId && <p className="drive-switch-caption">{t("driveLocalDirectory")}</p>}
    {userId ? <PickerDirectory userId={userId} currentChoirId={choirId} localOnly={localOnly} onSelect={close} />
      : <Link className="secondary-link" to={loginHref(`/choirs/${choirId}`)} onClick={close}>{t("driveSwitcherCheckAddedCloudDisk")}</Link>}
    <footer className="drive-switch-actions">
      <Button autoFocus={returnAction === "join"} isDisabled={localOnly} onPress={() => { setOpen(false); setAction("join"); }}><Plus size={17} aria-hidden="true" />{userId ? t("driveSwitcherAddNewCloudDisk") : t("driveSwitcherEnterOtherCloudDisks")}</Button>
      {identity.authenticatedUserId && <Button autoFocus={returnAction === "create"} className="drive-switch-create" isDisabled={localOnly} onPress={() => { setOpen(false); setAction("create"); }}>{t("driveSwitcherCreateCloudDisk")}</Button>}
    </footer>
    {localOnly && <p className="drive-switch-caption">{t("driveSwitcherJoinCreateCloudDisk")}</p>}
  </>}</Dialog>;
  return <><DialogTrigger isOpen={open} onOpenChange={open => {
    setOpen(open);
    if (open) {
      setReturnAction(null);
      libraryPosition.current = { left: window.scrollX, top: window.scrollY };
    } else requestAnimationFrame(() => {
      triggerRef.current?.focus({ preventScroll: true });
      restoreLibraryPosition();
    });
  }}>
    <Button ref={triggerRef} className="drive-switch-trigger" isDisabled={loading && !userId} aria-label={t("driveSwitcherSwitchCloudDisk2", { choirName: String(choirName) })}><span>{choirName}</span><ChevronDown size={17} aria-hidden="true" /></Button>
    {narrow ? <ModalOverlay className="drive-switch-overlay" isDismissable><Modal className="drive-switch-sheet">{content}</Modal></ModalOverlay>
      : <Popover className="drive-switch-popover" placement="bottom start">{content}</Popover>}
  </DialogTrigger>
    <JoinDriveDialog open={action === "join"} onClose={closeAction} onBack={returnToPicker} identity={identity} />
    {identity.authenticatedUserId && <CreateDriveDialog userId={identity.authenticatedUserId} open={action === "create"} onBack={returnToPicker} onOpenChange={open => { if (!open) closeAction(); }} />}
  </>;
}

function PickerDirectory({ userId, currentChoirId, localOnly, onSelect }: {
  userId: string; currentChoirId: string; localOnly: boolean; onSelect(): void;
}) {
  const membership = useMembershipDirectory(userId, localOnly);
  const container = useRef<HTMLDivElement>(null);
  const settled = useRef(membership.directory.data !== null);
  const [slots, setSlots] = useState(() => Math.min(5, Math.max(1, membership.rows.length || (membership.knownEmpty ? 1 : 3))));
  useLayoutEffect(() => {
    if (settled.current || membership.directory.data === null) return;
    settled.current = true;
    // Settle a cold directory once. Keep its reserved size for this opening if
    // a pointer is currently pressing anywhere in the picker (including actions).
    if (!container.current?.closest(".drive-switch-content")?.matches(":active")) {
      setSlots(Math.min(5, Math.max(1, membership.rows.length)));
    }
  }, [membership.directory.data, membership.rows.length]);
  return <div ref={container} className="drive-switch-directory" style={{ "--drive-picker-rows": slots } as CSSProperties}>
    <MembershipDirectoryList membership={membership} currentChoirId={currentChoirId} localOnly={localOnly} onSelect={onSelect} />
  </div>;
}
