import { useMessages } from "../../i18n";
import { Button } from "react-aria-components";
import { GUEST_NOTE_LAYER_ID } from "../annotations/guest-notes";
import { LibraryTaskDialog, LibraryTaskLoading } from "../score-library/library-task-dialog";
import { LoadingStatus } from "../components/loading-status";
import { type ExportTarget } from "./export-session";
import { useExportSession } from "./use-export-session";
import "./export-dialog.css";

type Props = ExportTarget & { onClose(): void };

export function ExportDialog(props: Props) {
  const { workspace, versionId, fileName, authenticatedUserId } = props;
  const key = JSON.stringify([workspace.scopeKey, workspace.sessionEpoch, workspace.syncLockToken, versionId, fileName, authenticatedUserId]);
  return <ExportDialogContent key={key} {...props} />;
}

function ExportDialogContent(props: Props) {
  const t = useMessages("reader");
  const current = useExportSession(props);
  const { fileName, onClose } = props;
  if (!current) return <LibraryTaskLoading title={t("sharePdf")} size="tall" onClose={onClose} />;
  const { session, snapshot: { prepared, layers, selected, includeNotes, file, message, readError, sharing, shareFailed } } = current;
  const canShare = file ? canSharePdf(file) : false;
  const layerGroups = [
    { id: "shared", title: t("sharedLayer"), layers: layers.filter(layer => layer.kind === "shared") },
    { id: "personal", title: t("myPersonalLayers"), layers: layers.filter(layer => layer.kind === "personal" && layer.canEdit) },
    { id: "member-shares", title: t("memberShares"), layers: layers.filter(layer => layer.kind === "personal" && !layer.canEdit) },
  ];
  return <LibraryTaskDialog title={t("sharePdf")} size="tall" onClose={onClose} busy={sharing}><div className="export-dialog">
    <p className="export-file-name">{fileName}</p>
    {!prepared && !message && <LoadingStatus>{t("preparingPdfAndNotes")}</LoadingStatus>}
    {prepared && <>
      <fieldset className="export-mode" disabled={sharing}><legend>{t("shareContents")}</legend>
        <label><input type="radio" name="export-content" checked={!includeNotes} onChange={() => { session.setIncludeNotes(false); }} />{t("originalScoreOnly")}</label>
        <label><input type="radio" name="export-content" checked={includeNotes} onChange={() => { session.setIncludeNotes(true); }} />{t("containsNotes")}</label>
      </fieldset>
      {includeNotes && <div className="export-layers">
        <p className="export-help">{t("selectingNotesToIncludeWillNotChange")}</p>
        {layerGroups.map(group => group.layers.length > 0 && <fieldset key={group.id} disabled={sharing}>
          <legend>{group.title}</legend>
          {group.layers.map(layer => <label className="export-layer" key={layer.id}>
            <input type="checkbox" checked={selected.includes(layer.id)} onChange={event => { session.setLayerSelected(layer.id, event.target.checked); }} />
            <span className="export-layer-color" style={{ background: layer.displayColor }} />
            <span>{layer.id === GUEST_NOTE_LAYER_ID ? t("previewNotes") : layer.name}</span>
          </label>)}
        </fieldset>)}
        {layers.length === 0 && <p>{t("noShareableLayers")}</p>}
        <p className="export-help">{selected.length ? t("exportSelectionCount", { count: selected.length }) : t("exportOriginalWhenEmpty")}</p>
      </div>}
    </>}
    {includeNotes && selected.some(id => !layers.some(layer => layer.id === id)) && <p role="alert">{t("unavailableExportLayers")}<Button isDisabled={sharing} onPress={session.removeUnavailableLayers}>{t("removeUnavailableLayers")}</Button></p>}
    {readError && <p role="alert">{readError}<Button className="text-button" onPress={session.retry}>{t("retryRead")}</Button></p>}
    {message && <p role="alert">{message}{!file && <Button className="text-button" onPress={session.retry}>{t("retry")}</Button>}</p>}
    {file && !sharing && <p className="export-help" role="status">{canShare ? t("preparedPdfShare") : t("preparedPdfDownload")}</p>}
    <div className="export-actions">
      <Button className="secondary-button" isDisabled={sharing} onPress={onClose}>{t("cancel")}</Button>
      {file && canShare && shareFailed && <Button className="secondary-button" isDisabled={sharing} onPress={() => downloadPdf(file)}>{t("downloadPdf")}</Button>}
      <Button className="primary-button" isDisabled={sharing || !file} onPress={() => { if (!file) return; if (canShare) void session.share(); else downloadPdf(file); }}>{!file ? message || readError ? t("sharePdf") : t("preparing") : sharing ? t("sharing") : file ? canShare ? t("sharePdf") : t("downloadPdf") : t("sharePdf")}</Button>
    </div>
  </div></LibraryTaskDialog>;
}

function canSharePdf(file: File) {
  try { return typeof navigator.share === "function" && navigator.canShare?.({ files: [file] }) === true; }
  catch { return false; }
}

function downloadPdf(file: File) {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url; link.download = file.name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
