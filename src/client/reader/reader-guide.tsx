import { useMessages } from "../../i18n";
import { ArrowDown, ArrowLeft, ArrowRight, MoveHorizontal, MoveVertical, Expand, Hand } from "lucide-react";
import { Button, Modal, ModalOverlay } from "react-aria-components";
import { Dialog } from "../navigation/overlays";

export function ReaderGuide({ layout, onDismiss }: { layout: "page" | "continuous"; onDismiss(): void }) {
  const t = useMessages("reader");
  const edges = layout === "page";
  return <ModalOverlay isOpen isKeyboardDismissDisabled className="reader-guide" onOpenChange={open => { if (!open) onDismiss(); }}>
    <Modal className="reader-guide__surface">
      <Dialog aria-label={t("readerGuideDialog")} className="reader-guide__content">
        <header className="reader-guide__heading"><span>{t("readerGuide")}</span><Button autoFocus onPress={onDismiss}>{t("gotIt")}</Button></header>
        <div className="reader-guide__zones" data-edges={edges || undefined}>
          {edges && <div><ArrowLeft size={26} aria-hidden="true" /><strong>{t("tapLeft")}</strong><span>{t("previousInFullPage")}</span></div>}
          <div><Hand size={28} aria-hidden="true" /><strong>{edges ? t("tapCenter") : t("tapScore")}</strong><span>{t("toggleToolbar")}</span></div>
          {edges && <div><ArrowRight size={26} aria-hidden="true" /><strong>{t("tapRight")}</strong><span>{t("nextInFullPage")}</span></div>}
        </div>
        <div className="reader-guide__gestures">
          {layout === "page" && <span><MoveHorizontal size={19} aria-hidden="true" /><strong>{t("swipeHorizontally")}</strong>{t("turnPages")}</span>}
          <span><Expand size={19} aria-hidden="true" /><strong>{t("doubleTapScore")}</strong>{t("zoomOrReset")}</span>
          {layout === "continuous"
            ? <span><MoveVertical size={19} aria-hidden="true" /><strong>{t("swipeVertically")}</strong>{t("scrollContinuously")}</span>
            : <span><ArrowDown size={19} aria-hidden="true" /><strong>{t("swipeDownFullPage")}</strong>{t("closeSheetMusic")}</span>}
        </div>
        {layout === "continuous" && <p className="reader-guide__detail">{t("continuousZoomHelp")}</p>}
        {layout === "page" && <p className="reader-guide__detail">{t("pagedZoomHelp")}</p>}
        <details className="reader-guide__detail"><summary>{t("keyboardEditing")}</summary><p>{t("keyboardShortcuts")}</p></details>
      </Dialog>
    </Modal>
  </ModalOverlay>;
}
