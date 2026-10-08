import { useCallback, useSyncExternalStore } from "react";
import type { PDFDocumentProxy } from "./pdf-document";

export const FALLBACK_PAGE_RATIO = 0.707;

// Metadata belongs to the PDF document, independently of layout and canvas leases.
// Sharing the document also shares pending reads and successful geometry.
class PdfPageGeometry {
  private pages = new Map<number, number>();
  private pending = new Set<number>();
  private failed = new Set<number>();
  private listeners = new Set<() => void>();
  private ratios: readonly number[] = [];

  constructor(private document: PDFDocumentProxy) {}

  page = (page: number) => this.pages.get(page) ?? FALLBACK_PAGE_RATIO;
  all = () => this.ratios;

  subscribe(page: number | undefined, listener: () => void) {
    this.listeners.add(listener);
    if (page === undefined) {
      for (let index = 1; index <= this.document.numPages; index++) this.load(index);
    } else this.load(page);
    return () => { this.listeners.delete(listener); };
  }

  private load(page: number) {
    if ((this.pages.has(page) && !this.failed.has(page)) || this.pending.has(page)) return;
    this.pending.add(page);
    void (async () => {
      let ratio = FALLBACK_PAGE_RATIO;
      try {
        const value = await this.document.getPage(page);
        const viewport = value.getViewport({ scale: 1 });
        const candidate = viewport.width / viewport.height;
        if (![viewport.width, viewport.height, candidate].every(value => Number.isFinite(value) && value > 0)) {
          throw new Error("invalid_page_geometry");
        }
        ratio = candidate;
        this.failed.delete(page);
      } catch { this.failed.add(page); }
      this.pages.set(page, ratio);
      this.pending.delete(page);
      if (this.pages.size === this.document.numPages) {
        this.ratios = Array.from({ length: this.document.numPages }, (_, index) => this.page(index + 1));
      }
      this.listeners.forEach(listener => listener());
    })();
  }
}

const documents = new WeakMap<PDFDocumentProxy, PdfPageGeometry>();
function geometryFor(document: PDFDocumentProxy) {
  let geometry = documents.get(document);
  if (!geometry) { geometry = new PdfPageGeometry(document); documents.set(document, geometry); }
  return geometry;
}

export function usePdfPageAspectRatio(document: PDFDocumentProxy, page: number, knownRatio?: number) {
  const geometry = geometryFor(document);
  return useSyncExternalStore(
    useCallback(listener => knownRatio === undefined ? geometry.subscribe(page, listener) : () => {}, [geometry, page, knownRatio]),
    () => knownRatio ?? geometry.page(page),
  );
}

export function usePdfPageAspectRatios(document: PDFDocumentProxy) {
  const geometry = geometryFor(document);
  return useSyncExternalStore(
    useCallback(listener => geometry.subscribe(undefined, listener), [geometry]),
    geometry.all,
  );
}
