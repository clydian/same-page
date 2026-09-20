import { FALLBACK_PAGE_RATIO, usePdfPageAspectRatios } from "./use-pdf-page-geometry";
import { capturePaperAnchor, constrainReaderPosition } from "./reader-zoom";
import { useElementSize } from "./use-element-size";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useReturnViewport } from "../navigation/use-return-viewport";
import type { PDFDocumentProxy } from "./pdf-document";
import type { ReaderZoomGeometry } from "./use-reader-zoom";
import { calculateFittedPageWidth } from "./reader-dimensions";

const PAGE_GAP = 8;

interface ContinuousReaderLayoutOptions {
  document: PDFDocumentProxy;
  currentPage: number;
  zoom: number;
  fitRequest?: number;
  navigationRequest?: number;
  editing: boolean;
  onZoomChange(zoom: number): void;
  onPageChange(page: number): void;
  beforePageChange?(): Promise<boolean>;
  canCompletePage?(): boolean;
}

// Owns measurement, fitting and the scroll commit. Callers render the returned
// geometry and connect the gesture capabilities; they do not sequence commands.
export function useContinuousReaderLayout({
  document, currentPage, zoom, fitRequest = 0, navigationRequest = 0, editing,
  onZoomChange, onPageChange, beforePageChange, canCompletePage,
}: ContinuousReaderLayoutOptions) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(scrollRef);
  const [anchorSelection, setAnchorSelection] = useState<{ document: PDFDocumentProxy; page: number } | null>(null);
  const anchorPage = anchorSelection?.document === document ? anchorSelection.page : null;
  const fitSuspended = useRef(false);
  const zoomLease = useRef<symbol | null>(null);
  const browseLease = useRef<symbol | null>(null);
  useLayoutEffect(() => {
    browseLease.current = null;
    return () => { browseLease.current = null; };
  }, [document, editing, currentPage, fitRequest, navigationRequest, size.width, size.height]);
  const pageWidth = Math.max(1, size.width * zoom);
  const ratios = usePdfPageAspectRatios(document);
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
    // Boundary padding lets short first/last pages sit at the viewport center.
    paddingStart: startPadding,
    paddingEnd: Math.max(0, (size.height - pageWidth / (ratios[document.numPages - 1] ?? FALLBACK_PAGE_RATIO)) / 2),
    rangeExtractor: range => [...new Set([...defaultRangeExtractor(range), currentPage - 1, ...(anchorPage === null ? [] : [anchorPage])])].sort((a, b) => a - b),
  });

  // Scroll offsets are pixels, but a viewport resize changes every preceding
  // page's height. Retain a paper-relative anchor, not the old pixel offset.
  const viewportGeometry = useRef<{
    document: PDFDocumentProxy; width: number; height: number; pageWidth: number;
    ratios: readonly number[]; padding: number; top: number; left: number;
  } | null>(null);
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element || !geometryReady || size.width <= 0 || size.height <= 0) return;
    const previous = viewportGeometry.current;
    const resized = previous?.document === document &&
      (previous.width !== size.width || previous.height !== size.height);
    const retainFit = !fitSuspended.current && fitRequest !== 0 &&
      Math.abs(zoom - commit.current.fitted.zoom) <= 0.001;
    if (resized && !retainFit && commit.current.alignedPage !== null) {
      const index = currentPage - 1;
      const pageStart = (width: number, aspects: readonly number[], padding: number) =>
        padding + aspects.slice(0, index).reduce((sum, ratio) => sum + width / ratio + PAGE_GAP, 0);
      const oldHeight = previous.pageWidth / previous.ratios[index];
      const y = (previous.top + previous.height / 2 - pageStart(previous.pageWidth, previous.ratios, previous.padding)) / oldHeight;
      const x = (previous.left + previous.width / 2) / Math.max(previous.width, previous.pageWidth);
      const top = pageStart(pageWidth, ratios, startPadding) + y * pageWidth / ratios[index] - size.height / 2;
      virtualizer.scrollToOffset(Math.max(0, top));
      element.scrollLeft = Math.max(0, x * Math.max(size.width, pageWidth) - size.width / 2);
      commit.current.programTop = element.scrollTop;
    }
    viewportGeometry.current = { document, ...size, pageWidth, ratios, padding: startPadding,
      top: element.scrollTop, left: element.scrollLeft };
  }, [document, geometryReady, size, pageWidth, ratios, startPadding, currentPage, fitRequest, zoom, virtualizer]);

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
    // Continuous editing shares the document's vertical bounds with reading.
    constrain: () => {},
    capture: (center) => {
      const token = Symbol();
      const origin = { top: scrollRef.current?.scrollTop ?? 0, left: scrollRef.current?.scrollLeft ?? 0 };
      const anchor = contentRef.current && capturePaperAnchor(contentRef.current, center);
      zoomLease.current = token;
      browseLease.current = token;
      if (anchor) setAnchorSelection({ document, page: anchor.pageIndex });
      return {
        anchor,
        release: (outcome) => {
          if (zoomLease.current !== token) return;
          zoomLease.current = null;
          if (outcome.status === "committed" && outcome.zoomChanged) fitSuspended.current = true;
          setAnchorSelection(null);
          if (outcome.status !== "committed" || !editing) return;
          const element = scrollRef.current;
          if (!element) return;
          const destination = virtualizer.getVirtualItemForOffset(element.scrollTop + element.clientHeight / 2);
          if (!destination || destination.index + 1 === currentPage) {
            return;
          }
          // Keep the outgoing editor mounted until local drafts are durable.
          // A new gesture, selection or scope invalidates this admission.
          void (async () => {
            let admitted = false;
            try { admitted = await beforePageChange?.() ?? true; } catch { /* Preserve the current page on a failed admission. */ }
            if (browseLease.current !== token) return;
            if (!admitted || (canCompletePage && !canCompletePage())) {
              if (!outcome.zoomChanged) {
                element.scrollTop = origin.top;
                element.scrollLeft = origin.left;
              } else {
                const paper = contentRef.current?.querySelector<HTMLElement>(`[data-index="${currentPage - 1}"] .annotated-pdf-page`);
                if (paper) constrainReaderPosition(element, paper.getBoundingClientRect());
              }
              return;
            }
            fitSuspended.current = true;
            commit.current.alignedPage = destination.index + 1;
            onPageChange(destination.index + 1);
          })();
        },
      };
    },
  };
  const geometryGestures = {
    zoomGeometry,
    continuous: true,
    nativeTouchScroll: !editing,
  };

  const onScroll = () => {
    const state = commit.current;
    const element = scrollRef.current;
    const geometry = viewportGeometry.current;
    // ResizeObserver and native scroll events can arrive in either order.
    // A scroll caused by changing viewport bounds is not a page selection.
    if (element && geometry) {
      if (element.clientWidth !== geometry.width || element.clientHeight !== geometry.height) return;
      geometry.top = element.scrollTop;
      geometry.left = element.scrollLeft;
    }
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
