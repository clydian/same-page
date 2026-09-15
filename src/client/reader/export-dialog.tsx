import { Button } from "react-aria-components";
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
  const current = useExportSession(props);
  const { fileName, onClose } = props;
  if (!current) return <LibraryTaskLoading title="分享 PDF" size="tall" onClose={onClose} />;
  const { session, snapshot: { prepared, layers, selected, includeNotes, file, message, readError, sharing, shareFailed } } = current;
  const canShare = file ? canSharePdf(file) : false;
  return <LibraryTaskDialog title="分享 PDF" size="tall" onClose={onClose} busy={sharing}><div className="export-dialog">
    <p className="export-file-name">{fileName}</p>
    {!prepared && !message && <LoadingStatus>正在准备 PDF 和笔记…</LoadingStatus>}
    {prepared && <>
      <fieldset className="export-mode" disabled={sharing}><legend>分享内容</legend>
        <label><input type="radio" name="export-content" checked={!includeNotes} onChange={() => { session.setIncludeNotes(false); }} />仅原谱</label>
        <label><input type="radio" name="export-content" checked={includeNotes} onChange={() => { session.setIncludeNotes(true); }} />包含笔记</label>
      </fieldset>
      {includeNotes && <div className="export-layers">
        <p className="export-help">选择要包含的笔记，不会改变阅读时的显示设置。</p>
        {([['共享层', layers.filter(layer => layer.kind === "shared")], ['我的个人层', layers.filter(layer => layer.kind === "personal" && layer.canEdit)], ['成员分享', layers.filter(layer => layer.kind === "personal" && !layer.canEdit)]] as const).map(([title, group]) => group.length > 0 && <fieldset key={title} disabled={sharing}><legend>{title}</legend>
          {group.map(layer => <label className="export-layer" key={layer.id}><input type="checkbox" checked={selected.includes(layer.id)} onChange={event => { session.setLayerSelected(layer.id, event.target.checked); }} /><span className="export-layer-color" style={{ background: layer.displayColor }} /><span>{layer.name}</span></label>)}
        </fieldset>)}
        {layers.length === 0 && <p>没有可分享的笔记层。</p>}
        <p className="export-help">{selected.length ? `已选 ${selected.length} 个笔记层` : "未选择笔记层，将分享原谱。"}</p>
      </div>}
    </>}
    {includeNotes && selected.some(id => !layers.some(layer => layer.id === id)) && <p role="alert">部分已选层不再可用。<Button isDisabled={sharing} onPress={session.removeUnavailableLayers}>移除不可用层</Button></p>}
    {readError && <p role="alert">{readError}<Button className="text-button" onPress={session.retry}>重试读取</Button></p>}
    {message && <p role="alert">{message}{!file && <Button className="text-button" onPress={session.retry}>重试</Button>}</p>}
    {file && !sharing && <p className="export-help" role="status">{canShare ? "PDF 已准备好，点击“分享 PDF”选择发送或保存位置。" : "PDF 已准备好，可以下载到本机。"}</p>}
    <div className="export-actions">
      <Button className="secondary-button" isDisabled={sharing} onPress={onClose}>取消</Button>
      {file && canShare && shareFailed && <Button className="secondary-button" isDisabled={sharing} onPress={() => downloadPdf(file)}>下载 PDF</Button>}
      <Button className="primary-button" isDisabled={sharing || !file} onPress={() => { if (!file) return; if (canShare) void session.share(); else downloadPdf(file); }}>{!file ? message || readError ? "分享 PDF" : "正在准备…" : sharing ? "正在分享…" : file ? canShare ? "分享 PDF" : "下载 PDF" : "分享 PDF"}</Button>
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
