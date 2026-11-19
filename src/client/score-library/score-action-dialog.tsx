import { useMessages, getCurrentLocale, getMessages } from "../../i18n";
import { scoreDisplayName } from "../../shared/score-display-name";
import type { DriveLibrary } from "./drive-library";
import { useScoreFileAction } from "./use-score-file-action";
import { type FormEvent, lazy, Suspense, useState } from "react";
import {
  Button,

  Form,
  Input,
  Label,
  Modal,
  ModalOverlay,
  TextField,
} from "react-aria-components";
import { Dialog } from "../navigation/overlays";

import type { ScoreSummary } from "../../shared/scores";
import { LibraryDialogHeading } from "./library-dialog-heading";
import { LibraryTaskLoading } from "./library-task-dialog";

const PdfVersionDialog = lazy(() => import("./pdf-version-dialog").then((module) => ({ default: module.PdfVersionDialog })));

export type ScoreAction = "rename" | "replace" | "trash";

export interface ScoreActionSelection {
  action: ScoreAction;
  score: ScoreSummary;
}

export function ScoreActionDialog({
  choirId,
  library,
  writable = true,
  ownerUserId,
  selection,
  onClose,
  onComplete,
}: {
  writable?: boolean;
  ownerUserId?: string;
  library: DriveLibrary;
  canPurge?: boolean;
  choirId: string;
  selection: ScoreActionSelection;
  onClose: () => void;
  onComplete: (message: string) => void;
}) {
  const t = useMessages("library");
  if (selection.action === "replace") {
    return <Suspense fallback={<LibraryTaskLoading title={t("replacePdf")} onClose={onClose} />}><PdfVersionDialog ownerUserId={ownerUserId} writable={writable} choirId={choirId} score={selection.score}
      onClose={onClose} onComplete={async message => { await library.changed(); onComplete(message); }} /></Suspense>;
  }
  return <BasicScoreActionDialog writable={writable} library={library} choirId={choirId} selection={selection} onClose={onClose} onComplete={onComplete} />;
}

function BasicScoreActionDialog({ writable = true, library, selection, onClose, onComplete }: Parameters<typeof ScoreActionDialog>[0]) {
  const t = useMessages("library");
  const [renameValue, setRenameValue] = useState(scoreDisplayName(selection.score.fileName));
  const mutation = useScoreFileAction(library, selection.score, selection.action === "rename" ? "rename" : "trash", onComplete, writable);
  const busy = mutation.pending;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void mutation.submit(renameValue);
  };

  return (
    <ModalOverlay
      className="modal-overlay"
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      isDismissable={!busy}
    >
      <Modal className="app-modal app-modal--compact">
        <Dialog className="app-dialog">
          {({ close }) => (
            <>
              <LibraryDialogHeading title={actionTitle(selection.action)} close={close} />
              {!writable && <p role="status">{t("scoreAction")}</p>}
              <Form className="entry-form dialog-form" onSubmit={submit}>
                {selection.action === "rename" ? (
                  <TextField isRequired value={renameValue} onChange={setRenameValue} maxLength={255}>
                    <Label>{t("markdownAttachmentFileName")}</Label>
                    <Input autoFocus />
                  </TextField>
                ) : (
                  <p className="dialog-copy">
                    {t("confirmTrashScore", { name: selection.score.fileName })}</p>
                )}
                <Button
                  type="submit"
                  isDisabled={mutation.blocked}
                >
                  {busy ? t("pdfVersionProcessing") : selection.action === "trash" ? t("moveToTrash") : t("confirm")}
                </Button>
              </Form>
              {mutation.needsRefresh && <Button className="secondary-button" isDisabled={busy || !writable} onPress={() => void mutation.retry()}>{t("leaveDriveRereadStatus")}</Button>}
              {mutation.message ? (
                <p className="form-message" role="alert">
                  {mutation.message}
                </p>
              ) : null}
            </>
          )}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

function actionTitle(action: ScoreAction) {
  const t = getMessages(getCurrentLocale(), "library");
  if (action === "rename") return t("rename");
  return t("moveToTrash");
}
