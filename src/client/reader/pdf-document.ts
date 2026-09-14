import { diagnosticFetch } from "../diagnostics/diagnostics";
import type { PDFDocumentProxy, getDocument as GetDocument } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.mjs?url";
import { pdfJsWasmDirectory } from "../../shared/pdfjs-assets";

export class PdfEngineUnavailableError extends Error {
  constructor() { super("pdf_engine_unavailable"); this.name = "PdfEngineUnavailableError"; }
}

export function preloadPdfWorkerAsset(target: Document = document) {
  if (target.head.querySelector("link[data-same-page-pdf-worker]")) return;
  const preload = target.createElement("link");
  preload.rel = "modulepreload";
  preload.href = pdfWorkerUrl;
  preload.dataset.samePagePdfWorker = "true";
  target.head.append(preload);
}

export interface PdfLoadProgress {
  phase: "engine" | "file" | "document";
  loadedBytes: number | null;
  totalBytes: number | null;
}

export interface PdfDocumentLoad {
  promise: Promise<{
    document: PDFDocumentProxy;
    versionId: string | null;
  }>;
  destroy(): Promise<void>;
}

export function loadPdfDocument(
  source: string | ArrayBuffer,
  expectedVersionId?: string,
  onProgress?: (progress: PdfLoadProgress) => void,
): PdfDocumentLoad {
  const abortController = new AbortController();
  let destroyed = false;
  let loadingTask: ReturnType<typeof GetDocument> | null = null;
  let worker: import("pdfjs-dist").PDFWorker | null = null;
  let documentReady = false;
  const report = (progress: PdfLoadProgress) => { if (!destroyed && !documentReady) onProgress?.(progress); };
  const promise = (async () => {
    report({ phase: "engine", loadedBytes: null, totalBytes: null });
    // The current legacy build still requires this native API. Its absence is
    // an engine compatibility failure, not a corrupt PDF or a network problem.
    if (!("withResolvers" in Promise) || typeof Promise.withResolvers !== "function") throw new PdfEngineUnavailableError();
    let engine: typeof import("pdfjs-dist");
    try { engine = await import("pdfjs-dist/legacy/build/pdf.mjs"); }
    catch (error) {
      // Dynamic-import transport failures must stay retryable network errors.
      if (error instanceof Error && /fetch|network|loading chunk|module script|load failed|timeout/i.test(error.message)) throw Object.assign(error, { status: 0 });
      throw new PdfEngineUnavailableError();
    }
    if (destroyed) throw new DOMException("PDF load cancelled", "AbortError");
    engine.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    // getDocument normally creates this worker internally and waits before
    // starting any PDF request. Own it explicitly so preparation remains honest.
    worker = new engine.PDFWorker();
    await worker.promise;
    if (destroyed) throw new DOMException("PDF load cancelled", "AbortError");
    let resolvedSource = source;
    let actualVersionId = expectedVersionId ?? null;
    report({ phase: "file", loadedBytes: typeof source === "string" ? 0 : source.byteLength, totalBytes: typeof source === "string" ? null : source.byteLength });
    if (typeof source === "string" && !expectedVersionId) {
      const response = await diagnosticFetch(source, {
        method: "HEAD",
        credentials: "include",
        signal: abortController.signal,
      });
      if (!response.ok) throw Object.assign(new Error("pdf_head_failed"), { status: response.status });
      actualVersionId = response.headers.get("X-Score-Version");
      if (!actualVersionId) throw new Error("pdf_version_header_missing");
      resolvedSource = versionedPdfUrl(source, actualVersionId);
    }
    if (destroyed) throw new DOMException("PDF load cancelled", "AbortError");
    loadingTask = engine.getDocument({
      worker,
      wasmUrl: new URL(`/${pdfJsWasmDirectory}`, window.location.href).href,
      ...(typeof resolvedSource === "string"
        ? {
            url: resolvedSource,
            withCredentials: true,
            rangeChunkSize: 64 * 1024,
          }
        : { data: new Uint8Array(resolvedSource) }),
    });
    loadingTask.onProgress = ({ loaded, total }: { loaded: number; total: number }) => {
      const totalBytes = Number.isSafeInteger(total) && total > 0 ? total : null;
      const loadedBytes = Number.isSafeInteger(loaded) && loaded >= 0 ? (totalBytes ? Math.min(loaded, totalBytes) : loaded) : null;
      report({ phase: totalBytes !== null && loadedBytes === totalBytes ? "document" : "file", loadedBytes, totalBytes });
    };
    const document = await loadingTask.promise;
    documentReady = true;
    return { document, versionId: actualVersionId };
  })();
  return {
    promise,
    destroy: async () => {
      destroyed = true;
      abortController.abort();
      try { await loadingTask?.destroy(); }
      finally { worker?.destroy(); }
    },
  };
}

function versionedPdfUrl(currentUrl: string, versionId: string) {
  const suffix = "/pdf";
  if (!currentUrl.endsWith(suffix)) throw new Error("invalid_current_pdf_url");
  return `${currentUrl.slice(0, -suffix.length)}/versions/${encodeURIComponent(versionId)}/pdf`;
}

export type { PDFDocumentProxy };
