import { useMessages } from "../../i18n";
import { UploadProgressView } from "./upload-progress-view";
import { formatBytes } from "./library-format";
import { useEffect, useLayoutEffect } from "react";
import { Button,  Modal, ModalOverlay } from "react-aria-components";
import { Dialog } from "../navigation/overlays";

import { LibraryDialogHeading } from "./library-dialog-heading";
import { useUploadQueue } from "./use-upload-queue";

export function UploadDialog({ writable = true, choirId, storage, isOpen, onOpenChange, onComplete, onQuotaChange, onInspect }: {
  writable?: boolean;
  choirId: string;
  storage?: { usedBytes: number; limitBytes: number };
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void | Promise<void>;
  onQuotaChange: (blocked: boolean) => void;
  onInspect: (fileName: string) => void;
}) {
  const t = useMessages("library");
  const queue = useUploadQueue({ enabled: writable, choirId, onComplete, onQuotaChange });
  const waiting = queue.items.filter((item) => item.status === "queued").length;
  const uploading = queue.items.some((item) => item.status === "uploading");
  const hasUnfinished = waiting > 0 || uploading;
  const { stopWaiting } = queue;
  useLayoutEffect(() => {
    if (!isOpen) stopWaiting();
  }, [isOpen, stopWaiting]);
  useEffect(() => {
    if (!hasUnfinished) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasUnfinished]);

  const changeOpen = (open: boolean) => {
    if (!open) queue.stopWaiting();
    onOpenChange(open);
  };

  return <ModalOverlay className="modal-overlay" isOpen={isOpen} onOpenChange={changeOpen} isDismissable>
    <Modal className="app-modal"><Dialog className="app-dialog">
      <LibraryDialogHeading title={t("uploadUploadPdf")} close={() => changeOpen(false)} />
      {storage && <p className="dialog-copy">{t("uploadStorageCapacity", { available: formatBytes(Math.max(0, storage.limitBytes - storage.usedBytes)), limit: formatBytes(storage.limitBytes) })}</p>}
      <p className="dialog-copy">{t("uploadSelectMultiplePdfsDrag")}</p>
      <p className="dialog-copy">{t("uploadClosingWindowStopWaiting")}</p>
      <details className="upload-help"><summary>{t("uploadWhenLeavingPageUploading")}</summary>
        <p className="dialog-copy">{t("uploadLeavingCloudDiskSwitching")}</p>
      </details>
      {!writable && <p role="status">{t("uploadConnectionUploadPermissionHas")}</p>}
      <div className="upload-dropzone"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => { event.preventDefault(); queue.add(Array.from(event.dataTransfer.files)); }}>
        <label><span>{t("attachmentSelectPdfFile")}</span><input type="file" accept="application/pdf,.pdf" multiple disabled={!writable}
          onChange={(event) => {
            const files = Array.from(event.currentTarget.files ?? []);
            event.currentTarget.value = "";
            queue.add(files);
          }} /></label>
        <small>{t("uploadMaximumMbPerCopy")}</small>
      </div>
      <p role="status" aria-live="polite">{uploading ? t("uploadUploadingCopy") : t("uploadThereCurrentlyNoFiles")} {t("uploadQueueWaitingCount", { count: waiting })}</p>
      {queue.paused ? <p className="library-message" role="alert">
        {queue.paused === "uncertain" ? t("uploadQueueHasBeenPaused")
          : queue.paused === "quota" ? t("uploadQueueHasBeenSuspended")
          : queue.paused === "permission" ? t("uploadQueueHasBeenSuspended2") : t("uploadQueueHasBeenPaused2")}
      </p> : null}
      {queue.refreshFailed ? <p role="alert">{t("uploadFileStatusHasBeen")}</p> : null}
      {waiting > 0 ? <div className="upload-queue-actions">
        {queue.paused ? <Button className="secondary-button" isDisabled={!writable} onPress={queue.resume}>{t("uploadContinueWaitingItems")}</Button> : null}
        <Button className="text-button" onPress={queue.stopWaiting}>{t("uploadStopWaitingItems")}</Button>
      </div> : null}
      {queue.items.length > 0 ? <ul className="upload-list" aria-label={t("uploadUploadStatus")}>
        {queue.items.map((item) => <li key={item.id} data-status={item.status}>
          <span>{item.name}</span><strong>{item.message}</strong>
          {item.status === "uploading" ? <UploadProgressView name={item.name} progress={item.progress} /> : null}
          {item.status === "error" && item.file ? <Button className="text-button" isDisabled={!writable} aria-label={t("driveLayerPreferencesTryAgain", { name: String(item.name) })} onPress={() => queue.retry(item.id)}>{t("retry")}</Button> : null}
          {item.status === "unknown" || item.status === "success" ? <Button className="text-button" aria-label={t("uploadCheck", { name: String(item.name) })} onPress={() => { changeOpen(false); onInspect(item.name); }}>{t("uploadCheckFileLibrary")}</Button> : null}
        </li>)}
      </ul> : null}
    </Dialog></Modal>
  </ModalOverlay>;
}
