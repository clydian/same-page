import type { ReactNode } from "react";
import { Modal, ModalOverlay } from "react-aria-components";
import { Dialog } from "../navigation/overlays";
import { LoadingStatus } from "../components/loading-status";
import { LibraryDialogHeading } from "./library-dialog-heading";
import "./library-task-dialog.css";

type TaskFrameProps = { title: string; onClose: () => void; size?: "regular" | "tall" };

export function LibraryTaskDialog({ title, onClose, busy = false, size = "regular", children }: TaskFrameProps & { busy?: boolean; children: ReactNode }) {
  const close = () => { if (!busy) onClose(); };
  return <ModalOverlay className="modal-overlay" isOpen isDismissable={!busy} isKeyboardDismissDisabled={busy} onOpenChange={open => { if (!open) close(); }}>
    <Modal className="app-modal"><Dialog className={`app-dialog library-task-dialog library-task-dialog--${size}`} exitDisabled={busy}>
      <LibraryDialogHeading title={title} close={close} />
      <div className="library-task-dialog__body">{children}</div>
    </Dialog></Modal>
  </ModalOverlay>;
}

export function LibraryTaskLoading(props: TaskFrameProps) {
  return <LibraryTaskDialog {...props}><LoadingStatus>正在准备…</LoadingStatus></LibraryTaskDialog>;
}
