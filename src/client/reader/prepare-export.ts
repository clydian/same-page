import { readScoreAnnotationState, restoreOfflineAnnotationSnapshot } from "../annotations/annotation-state";
import { syncAnnotations } from "../annotations/sync";
import { findVerifiedOfflineScore } from "../offline/offline-score-verification";
import { assertLocalWorkspaceActive, type LocalWorkspace } from "../platform/local-workspace";
import { loadPdfDocument, type PdfDocumentLoad } from "./pdf-document";

// Own the PDF lifetime separately from the reader and offline preparation queue.
export function prepareExport(workspace: LocalWorkspace, versionId: string) {
  const controller = new AbortController();
  const { signal } = controller;
  let pdf: PdfDocumentLoad | undefined;
  const promise = (async () => {
    let source: string | ArrayBuffer;
    if (navigator.onLine) {
      await syncAnnotations(workspace, { pull: true, freshLayers: true, push: false, signal });
      source = `/api/choirs/${workspace.choirId}/scores/${workspace.scoreId}/versions/${encodeURIComponent(versionId)}/pdf`;
    } else {
      const copy = await findVerifiedOfflineScore(workspace);
      if (!copy || copy.versionId !== versionId) throw new Error("这份谱的完整 PDF 尚未保存在本机，请联网后导出。");
      await restoreOfflineAnnotationSnapshot(workspace, copy);
      source = await copy.blob.arrayBuffer();
    }
    await assertLocalWorkspaceActive(workspace);
    signal.throwIfAborted();
    pdf = loadPdfDocument(source, versionId);
    const [{ document }, state] = await Promise.all([pdf.promise, readScoreAnnotationState(workspace)]);
    await assertLocalWorkspaceActive(workspace);
    signal.throwIfAborted();
    if (!state.layersReady) throw new Error("笔记层尚未准备好，请联网后重试。");
    return { source: document, layers: state.layers };
  })().catch(error => { destroyPdf(); throw error; });
  function destroyPdf() {
    const owned = pdf;
    pdf = undefined;
    void owned?.destroy().catch(() => undefined);
  }
  return { promise, destroy: () => { controller.abort(); destroyPdf(); } };
}
