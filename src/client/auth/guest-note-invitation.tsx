import { useMessages } from "../../i18n";
import { Button, Heading, Modal, ModalOverlay } from "react-aria-components";
import { Link } from "react-router-dom";
import { Dialog } from "../navigation/overlays";
import "./guest-note-invitation.css";

export function GuestNoteDialog({ signInHref, onClose }: { signInHref: string; onClose: () => void }) {
  const t = useMessages("entry");
  return <ModalOverlay className="modal-overlay" isOpen isDismissable onOpenChange={open => { if (!open) onClose(); }}>
    <Modal className="app-modal app-modal--compact"><Dialog className="app-dialog guest-note-dialog">
      <Heading slot="title">{t("guestNotes.title")}</Heading>
      <p className="dialog-copy">{t("guestNotes.hint")}</p>
      <Link className="primary-button" to={signInHref}>{t("guestNotes.signIn")}</Link>
      <Button className="secondary-button" onPress={onClose}>{t("guestNotes.keepReading")}</Button>
    </Dialog></Modal>
  </ModalOverlay>;
}
