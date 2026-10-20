import { useState } from "react";
import { Link } from "react-router-dom";
import { Button, DialogTrigger, Heading, Modal, ModalOverlay, Popover } from "react-aria-components";
import { ChevronDown, FolderOpen, Plus, X } from "lucide-react";
import { Dialog } from "../navigation/overlays";
import { useCompactLayout } from "../platform/use-compact-layout";
import { MembershipList } from "./membership-list";
import { loginHref } from "../auth/login-return";

export function DriveSwitcher({ choirId, choirName, userId, localOnly, loading }: {
  choirId: string; choirName: string; userId?: string; localOnly: boolean; loading: boolean;
}) {
  const [open, setOpen] = useState(false);
  const narrow = useCompactLayout();
  const content = <Dialog className="drive-switch-content" aria-label="切换云盘">{({ close }) => <>
    <div className="dialog-heading"><Heading slot="title">切换云盘</Heading><Button className="icon-button" aria-label="关闭云盘选择" onPress={close}><X size={21} aria-hidden="true" /></Button></div>
    <p className="drive-switch-caption">我已加入的云盘{localOnly && userId ? " · 本机目录" : ""}</p>
    {userId ? <MembershipList userId={userId} currentChoirId={choirId} localOnly={localOnly} onSelect={close} />
      : <Link className="secondary-link" to={loginHref(`/choirs/${choirId}`)} onClick={close}>登录后查看已加入的云盘</Link>}
    <footer className="drive-switch-actions">
      <Link to="/drives?join=1" onClick={close}><Plus size={17} aria-hidden="true" />{userId ? "加入新云盘" : "进入其他云盘"}</Link>
      <Link to="/drives" onClick={close}><FolderOpen size={17} aria-hidden="true" />云盘列表</Link>
    </footer>
  </>}</Dialog>;
  return <DialogTrigger isOpen={open} onOpenChange={setOpen}>
    <Button className="drive-switch-trigger" isDisabled={loading && !userId} aria-label={`切换云盘：${choirName}`}><span>{choirName}</span><ChevronDown size={17} aria-hidden="true" /></Button>
    {narrow ? <ModalOverlay className="drive-switch-overlay" isDismissable><Modal className="drive-switch-sheet">{content}</Modal></ModalOverlay>
      : <Popover className="drive-switch-popover" placement="bottom start">{content}</Popover>}
  </DialogTrigger>;
}
