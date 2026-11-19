import { useMessages } from "../../../i18n";
import { loadPdfDocument } from "../../reader/pdf-document";
import { useEffect, useRef, useState } from "react";
import { Button } from "react-aria-components";
import { ChevronLeft, ChevronRight, Minus, Plus } from "lucide-react";
import type { PDFViewer } from "pdfjs-dist/types/web/pdf_viewer";
import "pdfjs-dist/web/pdf_viewer.css";

// PDF.js owns rendering, text, paging and zoom. No main-score workspace is opened.
export default function AttachmentPdfPreview({ url }: { url: string }) {
  const t = useMessages("library");
  const container = useRef<HTMLDivElement>(null);
  const viewer = useRef<PDFViewer | null>(null);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [error, setError] = useState(false);
  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    void (async () => {
      // The legacy viewer captures globalThis.pdfjsLib at import time. Load
      // its matching engine first, even though the document loader owns it.
      await import("pdfjs-dist/legacy/build/pdf.mjs");
      const components = await import("pdfjs-dist/legacy/web/pdf_viewer.mjs");
      if (disposed || !container.current) return;
      const eventBus = new components.EventBus();
      const linkService = new components.PDFLinkService({ eventBus, externalLinkTarget: 2 });
      const instance = new components.PDFViewer({ container: container.current, eventBus, linkService, annotationEditorMode: -1 });
      linkService.setViewer(instance); viewer.current = instance;
      const task = loadPdfDocument(url, "attachment");
      eventBus.on("pagesinit", () => { instance.currentScaleValue = "page-width"; });
      eventBus.on("pagechanging", ({ pageNumber }: { pageNumber: number }) => { if (!disposed) setPage(pageNumber); });
      cleanup = () => { viewer.current = null; linkService.setDocument(null); void task.destroy(); };
      const { document } = await task.promise;
      if (disposed) return;
      setPages(document.numPages); instance.setDocument(document); linkService.setDocument(document);
    })().catch(() => { if (!disposed) setError(true); });
    return () => { disposed = true; cleanup(); };
  }, [url]);
  return <div className="attachment-pdf">
    <div className="attachment-pdf-toolbar">
      <Button aria-label={t("pdfPreviewPreviousPage")} isDisabled={page <= 1} onPress={() => { if (viewer.current) viewer.current.currentPageNumber--; }}><ChevronLeft size={18} /></Button>
      <span aria-live="polite">{pages ? `${page} / ${pages}` : t("pdfPreviewLoading")}</span>
      <Button aria-label={t("pdfPreviewNextPage")} isDisabled={!pages || page >= pages} onPress={() => { if (viewer.current) viewer.current.currentPageNumber++; }}><ChevronRight size={18} /></Button>
      <Button aria-label={t("pdfPreviewZoomOut")} isDisabled={!pages} onPress={() => { if (viewer.current) viewer.current.currentScale = Math.max(0.25, viewer.current.currentScale / 1.2); }}><Minus size={18} /></Button>
      <Button aria-label={t("pdfPreviewEnlarge")} isDisabled={!pages} onPress={() => { if (viewer.current) viewer.current.currentScale = Math.min(4, viewer.current.currentScale * 1.2); }}><Plus size={18} /></Button>
    </div>
    {error && <p role="alert">{t("pdfPreviewPdfCannotPreviewedMoment")}</p>}
    <div className="attachment-pdf-container" ref={container}><div className="pdfViewer" /></div>
  </div>;
}
