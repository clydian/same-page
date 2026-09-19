import { capturePaperAnchor, constrainReaderPosition } from "./reader-zoom";
import { useElementSize } from "./use-element-size";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useReturnViewport } from "../navigation/use-return-viewport";
import type { PDFDocumentProxy } from "./pdf-document";
import type { ReaderZoomGeometry } from "./use-reader-zoom";
import { calculateFittedPageWidth } from "./reader-dimensions";

const PAGE_GAP = 8;
const FALLBACK_PAGE_RATIO = 0.707;

interface ContinuousReaderLayoutOptions {
  document: PDFDocumentProxy;
  currentPage: number;
  zoom: number;
  fitRequest?: number;
  navigationRequest?: number;
  editing: boolean;
  onZoomChange(zoom: number): void;
  onPageChange(page: number): void;
}

// Owns measurement, fitting and the scroll commit. Callers render the returned
// geometry and connect the gesture capabilities; they do not sequence commands.
export function useContinuousReaderLayout({
  document, currentPage, zoom, fitRequest = 0, navigationRequest = 0, editing,
  onZoomChange, onPageChange,
}: ContinuousReaderLayoutOptions) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(scrollRef);
  const [anchorSelection, setAnchorSelection] = useState<{ document: PDFDocumentProxy; page: number } | null>(null);
  const anchorPage = anchorSelection?.document === document ? anchorSelection.page : null;
  const fitSuspended = useRef(false);
  const zoomLease = useRef<symbol | null>(null);
  const pageWidth = Math.max(1, size.width * zoom);
  const ratios = usePageAspectRatios(document);
  const geometryReady = ratios.length === document.numPages;
  const startPadding = Math.max(0, (size.height - pageWidth / (ratios[0] ?? FALLBACK_PAGE_RATIO)) / 2);
  const commit = useRef<{
    document: PDFDocumentProxy;
    alignedPage: number | null;
    pending: { page: number; center: boolean } | null;
    fitted: { request: number; zoom: number };
    programTop: number | null;
    padding: number;
    navigationRequest: number;
  }>({ document, alignedPage: null, pending: null, fitted: { request: 0, zoom: 1 }, programTop: null, padding: 0, navigationRequest });
  useLayoutEffect(() => {
    if (commit.current.document !== document) {
      commit.current = { document, alignedPage: null, pending: null,
        fitted: { request: 0, zoom: 1 }, programTop: null, padding: 0, navigationRequest };
    }
    if (scrollRef.current) scrollRef.current.scrollTop += startPadding - commit.current.padding;
    commit.current.padding = startPadding;
  }, [document, startPadding, navigationRequest]);
  // PDF page geometry is known independently of canvas rendering. Key the
  // virtual measurements by that geometry, so zoom never reuses old heights.
  const getItemKey = useCallback((index: number) => `${index}:${pageWidth}:${ratios[index] ?? FALLBACK_PAGE_RATIO}`, [pageWidth, ratios]);
  // TanStack Virtual intentionally exposes mutable measurement functions.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: document.numPages,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => pageWidth / (ratios[index] ?? FALLBACK_PAGE_RATIO),
    gap: PAGE_GAP,
    getItemKey,
    overscan: 2,
    // Editing hides neighbours; padding lets even the first and last short
    // pages sit at the viewport center after a fit-and-turn.
    paddingStart: startPadding,
    paddingEnd: Math.max(0, (size.height - pageWidth / (ratios[document.numPages - 1] ?? FALLBACK_PAGE_RATIO)) / 2),
    rangeExtractor: range => [...new Set([...defaultRangeExtractor(range), currentPage - 1, ...(anchorPage === null ? [] : [anchorPage])])].sort((a, b) => a - b),
  });

  useEffect(() => {
    const state = commit.current;
    // Intent belongs to this document and current selection. A newer selection
    // supersedes a fit even if its zoom has not committed yet.
    if (state.pending?.page !== currentPage) state.pending = null;
    if (state.navigationRequest !== navigationRequest) {
      state.navigationRequest = navigationRequest;
      state.pending = { page: currentPage, center: true };
    }
    if (!geometryReady || size.width <= 0 || size.height <= 0) return;
    const newFit = fitRequest !== 0 && state.fitted.request !== fitRequest;
    if (newFit) fitSuspended.current = false;
    const retainFit = !fitSuspended.current && fitRequest !== 0 && Math.abs(zoom - state.fitted.zoom) <= 0.001;
    if (newFit || (!state.pending && retainFit)) {
      const next = calculateFittedPageWidth(size.width, size.height, ratios[currentPage - 1]) / size.width;
      if (newFit || Math.abs(next - zoom) > 0.001) {
        state.pending = { page: currentPage, center: true };
      }
    }
    if (state.pending) {
      const intent = state.pending;
      const next = calculateFittedPageWidth(size.width, size.height, ratios[intent.page - 1]) / size.width;
      state.fitted = { request: fitRequest, zoom: next };
      if (Math.abs(zoom - next) > 0.001) {
        onZoomChange(next);
        return;
      }
      if (scrollRef.current) scrollRef.current.scrollLeft = 0;
      // Keep the exact paper target inside the virtualizer's reconciliation;
      // a direct scroll correction would fight its queued row-center target.
      const target = virtualizer.getOffsetForIndex(intent.page - 1, intent.center ? "center" : "start");
      if (target) virtualizer.scrollToOffset(target[0]);
      state.programTop = scrollRef.current?.scrollTop ?? null;
      state.alignedPage = intent.page;
      state.pending = null;
      return;
    }
    if (editing || state.alignedPage === currentPage) return;
    state.alignedPage = currentPage;
    const element = scrollRef.current;
    const target = virtualizer.getVirtualItems().find(item => item.index === currentPage - 1);
    const visible = element && target && target.start >= element.scrollTop &&
      target.end <= element.scrollTop + element.clientHeight;
    if (!visible) {
      virtualizer.scrollToIndex(currentPage - 1, { align: "start" });
      state.programTop = element?.scrollTop ?? null;
    }
  }, [document, editing, currentPage, virtualizer, size.width, size.height, geometryReady, ratios, fitRequest, navigationRequest, zoom, onZoomChange]);

  // Restore only after the real list geometry exists. Restoring an estimated
  // list lets its later initial alignment erase the saved reading position.
  useReturnViewport(scrollRef, "continuous", geometryReady && size.width > 0 && size.height > 0);

  const zoomGeometry: ReaderZoomGeometry = {
    constrain: () => {
      const element = scrollRef.current;
      if (!element || !editing) return;
      const paper = contentRef.current?.querySelector<HTMLElement>(`[data-index="${currentPage - 1}"] .annotated-pdf-page`);
      if (paper) constrainReaderPosition(element, paper.getBoundingClientRect());
    },
    capture: (center) => {
      const token = Symbol();
      const anchor = contentRef.current && capturePaperAnchor(contentRef.current, center);
      zoomLease.current = token;
      if (anchor) setAnchorSelection({ document, page: anchor.pageIndex });
      return {
        anchor,
        release: (outcome) => {
          if (zoomLease.current !== token) return;
          zoomLease.current = null;
          if (outcome.status === "committed" && outcome.zoomChanged) fitSuspended.current = true;
          setAnchorSelection(null);
        },
      };
    },
  };
  const geometryGestures = {
    zoomGeometry,
    nativeTouchScroll: !editing,
  };

  const onScroll = () => {
    const state = commit.current;
    if (zoomLease.current !== null) return;
    if (state.document !== document || editing || state.pending || !geometryReady || state.alignedPage === null) return;
    const scrollTop = scrollRef.current?.scrollTop ?? 0;
    // A queued event from our own alignment is not a new page selection. A
    // different offset resumes ordinary viewport-center feedback immediately.
    if (state.programTop !== null && Math.abs(scrollTop - state.programTop) < 1) return;
    state.programTop = null;
    const threshold = scrollTop + (scrollRef.current?.clientHeight ?? 0) / 2;
    const item = virtualizer.getVirtualItemForOffset(threshold);
    if (item) {
      state.alignedPage = item.index + 1;
      onPageChange(item.index + 1);
    }
  };
  return {
    scrollRef, contentRef, onScroll, geometryGestures, size,
    width: Math.max(size.width, pageWidth), height: virtualizer.getTotalSize(),
    items: virtualizer.getVirtualItems().map(item => ({
      index: item.index, start: item.start, width: pageWidth,
      aspectRatio: ratios[item.index] ?? FALLBACK_PAGE_RATIO,
    })),
  };
}


function usePageAspectRatios(document: PDFDocumentProxy) {
  const [geometry, setGeometry] = useState<{ document: PDFDocumentProxy; ratios: number[] } | null>(null);
  useEffect(() => {
    let active = true;
    // Metadata only: this does not render or retain canvases for offscreen pages.
    void Promise.all(Array.from({ length: document.numPages }, async (_, index) => {
      try {
        const page = await document.getPage(index + 1);
        const viewport = page.getViewport({ scale: 1 });
        return viewport.width / viewport.height;
      } catch { return FALLBACK_PAGE_RATIO; }
    })).then(ratios => { if (active) setGeometry({ document, ratios }); });
    return () => { active = false; };
  }, [document]);
  return geometry?.document === document ? geometry.ratios : [];
}
