import type { ReactNode } from "react";
import { Button, Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { ArrowLeft, X } from "lucide-react";
import { useExitLayer } from "../../navigation/navigation-context";
import { useUnsavedChangesGuard } from "../../settings/use-unsaved-changes";
import { LoadingStatus } from "../../components/loading-status";
import { scoreDisplayName } from "../../../shared/score-display-name";
import type { AttachmentSelection } from "./attachment-list";
import { attachmentActionTitle } from "./attachment-presentation";
import "./attachments.css";

export function AttachmentShell({ title, subtitle, wide = false, document = false, picker = false, dirty = false, busy = false, save = async () => false, discard = () => {}, blocked = false, message = null, onClose, onBack, children }: {
  title: string; subtitle: string; wide?: boolean; document?: boolean; picker?: boolean; dirty?: boolean; busy?: boolean; save?: () => Promise<boolean>; discard?: () => void;
  blocked?: boolean; message?: string | null; onClose: () => void; onBack?: () => void; children: ReactNode;
}) {
  const guard = useUnsavedChangesGuard({ dirty, save, discard, saveState: { blocked: blocked || busy, message }, subject: "附件修改" });
  const close = async () => { if (!busy && await guard.confirm() === true) onClose(); };
  useExitLayer(true, "overlay", async destination => {
    if (busy) return "cancelled";
    if (destination) return true; // The form guard handles route navigation.
    if (await guard.confirm() !== true) return "cancelled";
    onClose(); return true;
  });
  return <><ModalOverlay className="modal-overlay" isOpen isDismissable={!busy} onOpenChange={open => { if (!open) void close(); }}>
    <Modal className={`app-modal attachment-modal${wide ? " attachment-modal--wide" : ""}`}><Dialog className={`app-dialog attachment-dialog${document ? " attachment-dialog--document" : ""}${picker ? " attachment-dialog--picker" : ""}`} data-update-busy={dirty || busy ? "true" : undefined}>
      <div className="attachment-heading">{onBack && <Button className="icon-button attachment-back" aria-label="返回附件类型" isDisabled={busy}
        onPress={async () => { if (await guard.confirm() === true) { discard(); onBack(); } }}><ArrowLeft size={19} /></Button>}
        <div><p>{subtitle}</p><Heading slot="title">{title}</Heading></div>
        <Button className="icon-button" aria-label="关闭" isDisabled={busy} onPress={() => void close()}><X size={20} /></Button></div>
      {children}
      {message && <p className="form-message" role="alert">{message}</p>}
    </Dialog></Modal>
  </ModalOverlay>{guard.confirmation}</>;
}


export function AttachmentLoading({ selection, onClose }: { selection: AttachmentSelection; onClose: () => void }) {
  const document = selection.action === "markdown" || (selection.action === "open" && selection.attachment?.kind === "markdown");
  const pdf = selection.action === "open" && selection.attachment?.kind === "pdf";
  return <AttachmentShell title={attachmentActionTitle(selection.action, selection.attachment)} subtitle={scoreDisplayName(selection.score.fileName)}
    wide={document || pdf} document={document} picker={selection.action === "add"} onClose={onClose}>
    <LoadingStatus className={pdf ? "attachment-pdf" : ""}>正在打开附件…</LoadingStatus>
  </AttachmentShell>;
}
