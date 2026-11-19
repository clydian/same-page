import { ExportError } from "./export-error";
import type { LocalWorkspace } from "../platform/local-workspace";
import { assertLocalWorkspaceActive } from "../platform/local-workspace";
import { readScoreAnnotationState } from "../annotations/annotation-state";
import { syncAnnotations, refreshLayerCapabilities } from "../annotations/sync";
import { findVerifiedOfflineScore } from "../offline/offline-score-verification";
import { exportAnnotatedPdf } from "./export-pdf";
import type { PDFDocumentProxy } from "./pdf-document";

export async function exportScore(workspace: LocalWorkspace, source: PDFDocumentProxy, versionId: string, selected: string[], authenticatedUserId: string | null, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const online = navigator.onLine;
  let offlineCopy: Awaited<ReturnType<typeof findVerifiedOfflineScore>> = null;
  if (online) {
    if (workspace.ownerKey.startsWith("user:") && workspace.ownerKey !== `user:${authenticatedUserId}`) throw new ExportError("exportSignInRequired");
    await syncAnnotations(workspace, { pull: true, freshLayers: true, push: false, signal });
  } else if (selected.length) {
    const copy = offlineCopy = await findVerifiedOfflineScore(workspace);
    if (!copy || copy.versionId !== versionId || selected.some(id => !copy.annotationSnapshot.layers.some(layer => layer.id === id))) throw new ExportError("exportOfflineNotesMissing");
  }
  signal?.throwIfAborted();
  const state = await readScoreAnnotationState(workspace);
  if (selected.some(id => !state.layers.some(layer => layer.id === id))) throw new ExportError("exportLayersUnavailable");
  const layers = state.layers.filter(layer => selected.includes(layer.id));
  const annotations = [...new Map([...(offlineCopy?.annotationSnapshot.annotations ?? []), ...state.annotations].map(annotation => [annotation.id, annotation])).values()];
  const blob = selected.length ? await exportAnnotatedPdf(source, annotations, layers, signal) : new Blob([new Uint8Array(await source.getData())], { type: "application/pdf" });
  signal?.throwIfAborted();
  await assertLocalWorkspaceActive(workspace);
  if (online) await refreshLayerCapabilities(workspace, signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000));
  // A revocation received by another window during rendering must also win.
  const latest = await readScoreAnnotationState(workspace);
  if (selected.some(id => !latest.layers.some(layer => layer.id === id))) throw new ExportError("exportPermissionsChanged");
  if (selected.length && JSON.stringify(state.annotations) !== JSON.stringify(latest.annotations)) throw new ExportError("exportNotesChanged");
  if (layers.some(layer => latest.layers.find(current => current.id === layer.id)?.displayColor !== layer.displayColor)) throw new ExportError("exportColorsChanged");
  signal?.throwIfAborted();
  return { blob, snapshot: JSON.stringify(latest) };
}
