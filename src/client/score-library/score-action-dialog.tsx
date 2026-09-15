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
  canPurge = false,
  selection,
  onClose,
  onComplete,
}: {
  library: DriveLibrary;
  canPurge?: boolean;
  choirId: string;
  selection: ScoreActionSelection;
  onClose: () => void;
  onComplete: (message: string) => void;
}) {
  if (selection.action === "replace") {
    return <Suspense fallback={<LibraryTaskLoading title="替换 PDF" onClose={onClose} />}><PdfVersionDialog canPurge={canPurge} choirId={choirId} score={selection.score} historyOnly={false}
      onClose={onClose} onComplete={async message => { await library.changed(); onComplete(message); }} /></Suspense>;
  }
  return <BasicScoreActionDialog library={library} choirId={choirId} selection={selection} onClose={onClose} onComplete={onComplete} />;
}

function BasicScoreActionDialog({ library, selection, onClose, onComplete }: Parameters<typeof ScoreActionDialog>[0]) {
  const [renameValue, setRenameValue] = useState(scoreDisplayName(selection.score.fileName));
  const mutation = useScoreFileAction(library, selection.score, selection.action === "rename" ? "rename" : "trash", onComplete);
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
              <Form className="entry-form dialog-form" onSubmit={submit}>
                {selection.action === "rename" ? (
                  <TextField isRequired value={renameValue} onChange={setRenameValue} maxLength={255}>
                    <Label>文件名</Label>
                    <Input autoFocus />
                  </TextField>
                ) : (
                  <p className="dialog-copy">
                    “{selection.score.fileName}”将从文件库消失，三十天内可从回收站恢复。
                  </p>
                )}
                <Button
                  type="submit"
                  isDisabled={mutation.blocked}
                >
                  {busy ? "正在处理…" : selection.action === "trash" ? "移到回收站" : "确认"}
                </Button>
              </Form>
              {mutation.needsRefresh && <Button className="secondary-button" isDisabled={busy} onPress={() => void mutation.retry()}>重新读取状态</Button>}
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
  if (action === "rename") return "重命名";
  return "移到回收站";
}
