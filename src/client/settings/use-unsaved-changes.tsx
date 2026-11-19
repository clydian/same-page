import { useMessages } from "../../i18n";
import { useEffect, useRef, useState } from "react";
import { Button, Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { useExitLayer } from "../navigation/navigation-context";

// A manual form never submits merely because navigation was requested.
type UnsavedOptions = {
  dirty: boolean; subject?: string; save(): Promise<boolean>; discard(): void;
  saveState?: { blocked: boolean; message: string | null };
};

export function useUnsavedChanges(options: UnsavedOptions) {
  return useUnsavedChangesGuard(options).confirmation;
}

export function useUnsavedChangesGuard({ dirty, save, discard, saveState, subject }: {
  dirty: boolean; subject?: string; save(): Promise<boolean>; discard(): void;
  saveState?: { blocked: boolean; message: string | null };
}) {
  const t = useMessages("library");
  const resolve = useRef<((result: boolean | "cancelled") => void) | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => () => { resolve.current?.("cancelled"); }, []);
  const confirm = () => !dirty ? Promise.resolve(true as const) : new Promise<boolean | "cancelled">(done => {
    resolve.current = done; setFailed(false); setOpen(true);
  });
  useExitLayer(dirty, "form", confirm);
  const finish = (result: boolean | "cancelled") => {
    setOpen(false); resolve.current?.(result); resolve.current = null;
  };
  const confirmation = <ModalOverlay className="modal-overlay" isOpen={open} isDismissable={!saving} onOpenChange={value => { if (!value && !saving) finish("cancelled"); }}>
    <Modal className="app-modal app-modal--compact"><Dialog className="app-dialog" aria-label={t("useUnsavedChangesHandlingUnsavedChanges")}>
      <Heading slot="title">{dirty ? t("useUnsavedChangesThereUnsavedChanges") : t("useUnsavedChangesModificationsSaved")}</Heading><p>{dirty ? t("useUnsavedChangesHasNotBeenSaved", { subject: subject ?? t("useUnsavedChangesModification") }) : t("useUnsavedChangesSaveHasBeenConfirmed")}</p>
      {failed && <p role="alert">{saveState?.message ?? t("useUnsavedChangesSaveHasNotBeen")}</p>}
      <div className="unsaved-actions">
        <Button className="primary-button" isDisabled={saving || saveState?.blocked} onPress={async () => {
          setSaving(true);
          try { if (await save()) finish(true); else setFailed(true); }
          catch { setFailed(true); }
          finally { setSaving(false); }
        }}>{saving ? t("saving") : t("useUnsavedChangesSaveReturn")}</Button>
        <Button className="secondary-button" autoFocus isDisabled={saving} onPress={() => finish("cancelled")}>{t("useUnsavedChangesContinueEditing")}</Button>
        <Button className="unsaved-discard" isDisabled={saving} onPress={() => { discard(); finish(true); }}>{t("useUnsavedChangesAbandonModification")}</Button>
      </div>
    </Dialog></Modal>
  </ModalOverlay>;
  return { confirmation, confirm };
}
