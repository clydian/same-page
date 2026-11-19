import { useMessages } from "../../i18n";
import { Button,  DialogTrigger, Heading, Modal, ModalOverlay } from "react-aria-components";
import { Dialog } from "../navigation/overlays";
import type { DiagnosticReader } from "../../shared/diagnostic-report";
import { DiagnosticReportForm } from "./diagnostic-report-form";

export function DiagnosticReportDialog({ reader }: { reader: DiagnosticReader }) {
  const t = useMessages("system");
  return <DialogTrigger>
    <Button className="secondary-button">{t("diagnosticReportDialog.action")}</Button>
    <DiagnosticReportModal reader={reader} />
  </DialogTrigger>;
}

export function DiagnosticReportModal({ reader, isOpen, onOpenChange }: {
  reader: DiagnosticReader;
  isOpen?: boolean;
  onOpenChange?(isOpen: boolean): void;
}) {
  const t = useMessages("system");
  return <ModalOverlay className="diagnostic-overlay" isDismissable isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal className="diagnostic-modal">
        <Dialog>
          {({ close }) => <>
            <div className="diagnostic-dialog-heading">
              <Heading slot="title">{t("diagnosticReportDialog.title")}</Heading>
              <Button className="secondary-button" onPress={close}>{t("diagnosticReportDialog.close")}</Button>
            </div>
            <DiagnosticReportForm reader={reader} />
          </>}
        </Dialog>
      </Modal>
    </ModalOverlay>;
}
