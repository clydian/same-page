import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button, DialogTrigger, Heading, Modal, ModalOverlay, Popover } from "react-aria-components";
import { ChevronDown, Plus, X } from "lucide-react";
import { Dialog } from "../navigation/overlays";
import { useCompactLayout } from "../platform/use-compact-layout";
import { MembershipList } from "./membership-list";
import { CreateDriveDialog } from "../drives/create-drive";
import { JoinDriveDialog } from "../drives/join-drive-dialog";
import { useApplicationIdentity } from "../auth/application-identity";
import { loginHref } from "../auth/login-return";

export function DriveSwitcher({ choirId, choirName, userId, localOnly, loading }: {
  choirId: string; choirName: string; userId?: string; localOnly: boolean; loading: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState<"join" | "create" | null>(null);
  const [returnAction, setReturnAction] = useState<"join" | "create" | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const identity = useApplicationIdentity();
  const closeAction = () => {
    setAction(null);
    requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
  };
  const returnToPicker = () => {
    setReturnAction(action);
    setAction(null);
    setOpen(true);
  };
  const narrow = useCompactLayout();
  const content = <Dialog className="drive-switch-content" aria-label="切换云盘">{({ close }) => <>
    <div className="dialog-heading"><Heading slot="title">切换云盘</Heading><Button className="icon-button" aria-label="关闭云盘选择" onPress={close}><X size={21} aria-hidden="true" /></Button></div>
    <p className="drive-switch-caption">我已加入的云盘{localOnly && userId ? " · 本机目录" : ""}</p>
    {userId ? <MembershipList userId={userId} currentChoirId={choirId} localOnly={localOnly} onSelect={close} />
      : <Link className="secondary-link" to={loginHref(`/choirs/${choirId}`)} onClick={close}>登录后查看已加入的云盘</Link>}
    <footer className="drive-switch-actions">
      <Button autoFocus={returnAction === "join"} isDisabled={localOnly} onPress={() => { setOpen(false); setAction("join"); }}><Plus size={17} aria-hidden="true" />{userId ? "加入新云盘" : "进入其他云盘"}</Button>
      {identity.authenticatedUserId && <Button autoFocus={returnAction === "create"} className="drive-switch-create" isDisabled={localOnly} onPress={() => { setOpen(false); setAction("create"); }}>创建云盘</Button>}
    </footer>
    {localOnly && <p className="drive-switch-caption">联网后可加入或创建云盘。</p>}
  </>}</Dialog>;
  return <><DialogTrigger isOpen={open} onOpenChange={open => {
    setOpen(open);
    if (open) setReturnAction(null);
    else requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
  }}>
    <Button ref={triggerRef} className="drive-switch-trigger" isDisabled={loading && !userId} aria-label={`切换云盘：${choirName}`}><span>{choirName}</span><ChevronDown size={17} aria-hidden="true" /></Button>
    {narrow ? <ModalOverlay className="drive-switch-overlay" isDismissable><Modal className="drive-switch-sheet">{content}</Modal></ModalOverlay>
      : <Popover className="drive-switch-popover" placement="bottom start">{content}</Popover>}
  </DialogTrigger>
    <JoinDriveDialog open={action === "join"} onClose={closeAction} onBack={returnToPicker} identity={identity} />
    {identity.authenticatedUserId && <CreateDriveDialog userId={identity.authenticatedUserId} open={action === "create"} onBack={returnToPicker} onOpenChange={open => { if (!open) closeAction(); }} />}
  </>;
}
