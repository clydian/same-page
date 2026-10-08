import { Button, Heading, Modal, ModalOverlay } from "react-aria-components";
import { Link } from "react-router-dom";
import { Dialog } from "../navigation/overlays";
import { loginHref } from "./login-return";
import "./guest-note-invitation.css";

const description = "注册或登录并加入此云盘，即可记录自己的笔记，并在不同设备间同步。";

export function GuestNoteDialog({ returnTo, onClose }: { returnTo: string; onClose: () => void }) {
  return <ModalOverlay className="modal-overlay" isOpen isDismissable onOpenChange={open => { if (!open) onClose(); }}>
    <Modal className="app-modal app-modal--compact"><Dialog className="app-dialog guest-note-dialog">
      <Heading slot="title">登录后，记下你的排练笔记</Heading>
      <p className="dialog-copy">你正在以访客身份浏览。{description}</p>
      <Link className="primary-button" to={loginHref(returnTo)}>注册 / 登录，开始记笔记</Link>
      <Button className="secondary-button" onPress={onClose}>继续看谱</Button>
    </Dialog></Modal>
  </ModalOverlay>;
}
