import { useMessages } from "../../i18n";
import { AnnotationPages, AnnotationPagesContext } from "../annotations/annotation-pages";
import { usePdfPageAspectRatio } from "./use-pdf-page-geometry";
import { FIT_ZOOM_TOLERANCE } from "./reader-zoom";
import { useElementSize } from "./use-element-size";
import { useReturnViewport } from "../navigation/use-return-viewport";
import { useContinuousReaderLayout } from "./use-continuous-reader-layout";
import {
  type CSSProperties,
  type TransitionEvent as ReactTransitionEvent,
  lazy,
  type RefObject,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useSyncExternalStore,
  useRef,
  useState,
} from "react";
import { Button, DialogTrigger, Modal, ModalOverlay } from "react-aria-components";
import { ChevronDown, X } from "lucide-react";
import { Dialog } from "../navigation/overlays";
import { ReaderPageGrid } from "./reader-page-grid";

import type { AnnotationLayerSummary } from "../../shared/annotations";
import type {
  AnnotationOverlayInteraction,
  AnnotationInteractionHandle,
  AnnotationTool,
} from "../annotations/annotation-overlay";
import type { LocalAnnotationRecord } from "../platform/local-database";
import type { AnnotationEditor } from "../annotations/annotation-editor";
import type { PDFDocumentProxy } from "./pdf-document";
import { PdfPageCanvas, type PdfPageRenderLease } from "./pdf-page";
import {
  calculateFittedPageWidth,
  calculatePageTurnDistance,
} from "./reader-dimensions";
import { PAGE_TURN_SETTLE_MS, type PagedReader, type PagedReaderItem } from "./use-paged-reader";
import { useReaderGestures } from "./use-reader-gestures";

const PAGE_TURN_GUTTER_PX = 14;
const AnnotationOverlay = lazy(() =>
  import("../annotations/annotation-overlay").then((module) => ({
    default: module.AnnotationOverlay,
  })),
);

import type { ToolStyle } from "../annotations/tool-style";

export interface AnnotationPageProps {
  layers: AnnotationLayerSummary[];
  annotations: LocalAnnotationRecord[];
  editing: boolean;
  tool: AnnotationTool;
  toolColor?: string;
  toolStyle?: ToolStyle;
  onTextStyleChange?(style: Pick<ToolStyle, "fontScale" | "textAlign">): void;
  activeLayerId: string | null;
  onInteractionChange(interaction: AnnotationOverlayInteraction): void;
  editor: AnnotationEditor | null;
}

interface ReaderLayoutProps {
  viewportName?: string;
  document: PDFDocumentProxy;
  currentPage: number;
  zoom: number;
  fitRequest?: number;
  navigationRequest?: number;
  onZoomChange(value: number): void;
  onPageChange(page: number): void;
  onToggleChrome(): void;
  onDismiss?(): void;
  annotationProps: AnnotationPageProps;
}

export function PageLayout({
  document,
  currentPage,
  zoom,
  fitRequest = 0,
  onZoomChange,
  onToggleChrome,
  onDismiss,
  annotationProps,
  pager,
}: Omit<ReaderLayoutProps, "onPageChange"> & { pager: PagedReader }) {
  const t = useMessages("reader");
  const containerRef = useRef<HTMLDivElement>(null);
  const noteInteraction = useRef<AnnotationInteractionHandle>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const previewBoundaryRef = useRef<HTMLDivElement>(null);
  const takeover = useRef<{ page: number; outgoing: HTMLElement; incoming: HTMLElement; outgoingLeft: number; incomingLeft: number } | null>(null);
  const size = useElementSize(containerRef);
  const position = useViewportPosition(containerRef);
  useReturnViewport(containerRef, "page", size.width > 0);
  const pageRatio = usePdfPageAspectRatio(document, currentPage);
  const fitWidth = calculateFittedPageWidth(
    size.width,
    size.height,
    pageRatio,
  );
  const renderedWidth = Math.max(1, fitWidth * zoom);
  const renderedHeight = renderedWidth / pageRatio;
  const pageTurnDistance = calculatePageTurnDistance(
    size.width,
    PAGE_TURN_GUTTER_PX,
  );
  const showPageWindow = !annotationProps.editing || pager.phase !== "idle";
  const pageItems: PagedReaderItem[] = showPageWindow
    ? pager.items
    : [{ page: currentPage, position: 0 }];
  const previousPage = useRef(currentPage);
  useLayoutEffect(() => {
    if (previousPage.current === currentPage) return;
    previousPage.current = currentPage;
    if (containerRef.current) { containerRef.current.scrollLeft = 0; containerRef.current.scrollTop = 0; }
  }, [currentPage]);
  const requestPage = pager.request;
  useLayoutEffect(() => {
    const captured = takeover.current;
    if (captured && captured.page !== pager.anchorPage) {
      // Rebase both visible papers together. The old current paper changes
      // from the centered slot to a fitted neighbor at the same handoff.
      trackRef.current?.querySelectorAll<HTMLElement>(".page-reader__paper").forEach(paper => { paper.style.translate = ""; });
      const movement = captured.incoming.getBoundingClientRect().left - captured.incomingLeft;
      const correction = captured.outgoingLeft + movement - captured.outgoing.getBoundingClientRect().left;
      captured.outgoing.parentElement!.style.translate = `${correction}px`;
      takeover.current = null;
    } else if (pager.phase === "idle") {
      trackRef.current?.querySelectorAll<HTMLElement>(".page-reader__paper").forEach(paper => { paper.style.translate = ""; });
      takeover.current = null;
    }
  });
  const gestureHandlers = useReaderGestures({
    containerRef,
    contentRef,
    previewBoundaryRef,
    disabled: false,
    twoFingerOnly: annotationProps.editing,
    onNavigationStart: () => noteInteraction.current?.interrupt(),
    isObjectGestureActive: () => noteInteraction.current?.ownsObjectGesture() ?? false,
    zoom,
    onZoomChange,
    onTap: onToggleChrome,
    onDismiss,
    onEdgeTap: !annotationProps.editing && zoom <= 1 + FIT_ZOOM_TOLERANCE ? requestPage : undefined,
    tapEnabled: pager.phase === "idle",
    tapScope: document,
    tapRevision: `${currentPage}:${fitRequest}:${size.width}:${size.height}`,
    // The pager may commit the previous page while the next drag owns this contact.
    gestureRevision: `${fitRequest}:${size.width}:${size.height}`,

    pageTurn: pager.gesture,
    pageTurnExtent: pageTurnDistance,
    pageTurnProgress: committed => {
      samplePageTurnAnimations(trackRef.current);
      // The incoming paper also moves within its slot to arrive centered.
      // Read its painted position before it becomes the current paper; the
      // track alone omits that movement, especially in landscape gutters.
      const viewport = containerRef.current;
      const target = trackRef.current?.querySelector<HTMLElement>(
        "[data-page-turn-target] .annotated-pdf-page",
      );
      if (committed && viewport && target && pager.targetPage !== null) {
        const paper = target.getBoundingClientRect();
        const outgoing = contentRef.current?.querySelector<HTMLElement>(".annotated-pdf-page");
        if (outgoing) takeover.current = { page: pager.anchorPage, outgoing, incoming: target,
          outgoingLeft: outgoing.getBoundingClientRect().left, incomingLeft: paper.left };
        const bounds = viewport.getBoundingClientRect();
        const centeredLeft = bounds.left + (viewport.clientWidth - paper.width) / 2;
        return (paper.left - centeredLeft) / pageTurnDistance - Math.sign(pager.targetPage - pager.anchorPage);
      }
      const track = trackRef.current;
      return track ? new DOMMatrixReadOnly(getComputedStyle(track).transform).m41 / pageTurnDistance : pager.progress;
    },

  });

  return (
    <section className="page-reader" aria-label={t("pagedReading")}>
      {pager.failedPage !== null && <aside className="reader-page-failure" role="alert">
        {t("pageTurnFailed", { failedPage: pager.failedPage })}
        <Button onPress={pager.retryPage}>{t("retryPageTurning")}</Button>
      </aside>}
      <div
        className="page-reader__viewport"
        data-zoom={zoom}
        data-editing={annotationProps.editing || undefined}
        ref={containerRef}
        {...gestureHandlers}
      >
        <div
          className="page-reader__canvas-stage"
          data-underfit={zoom < 1 || undefined}
          style={{
            width: Math.max(size.width, renderedWidth),
            height: Math.max(size.height, renderedHeight),
          }}
        >
          <div
            className="page-reader__pager-window"
            ref={previewBoundaryRef}
            style={{
              width: renderedWidth,
              height: renderedHeight,
            }}
          >
            <div
              className="page-reader__pager-track"
              ref={trackRef}
              {...pageTurnPresentation(pager, pageTurnDistance)}
            >
              {pageItems.map((item) => (
                <div
                  aria-hidden={item.position === 0 ? undefined : true}
                  className="page-reader__sheet"
                  data-page-number={item.page}
                  data-page-turn-current={item.position === 0 || undefined}
                  data-page-turn-target={item.page === pager.targetPage || undefined}
                  key={pager.renderKey(item.page)}
                  style={{
                    "--page-turn-slot-offset": `${item.position * pageTurnDistance}px`,
                    ...(item.position !== 0 ? {
                      width: size.width, height: size.height,
                      left: position.x - Math.max(0, (size.width - renderedWidth) / 2),
                      top: position.y - Math.max(0, (size.height - renderedHeight) / 2),
                      visibility: zoom > 1 && pager.phase === "idle" ? "hidden" : undefined,
                    } : {}),
                  } as CSSProperties}
                >
                  <div
                    className="page-reader__content page-reader__paper"
                    ref={item.position === 0 ? contentRef : undefined}
                  >
                    <AnnotatedPdfPage
                      document={document}
                      pageNumber={item.page}
                      width={item.position === 0 ? renderedWidth : undefined}
                      fitViewport={item.position === 0 ? undefined : size}
                      turn={item.position === 0 ? undefined : { position: item.position, progress: pager.progress }}
                      aspectRatio={item.page === currentPage ? pageRatio : undefined}
                      annotationProps={item.position === 0 ? annotationProps : { ...annotationProps, editing: false }}
                      interactionRef={annotationProps.editing && item.position === 0 ? noteInteraction : undefined}
                      onPageRenderStart={pager.beginPageRender}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      {!annotationProps.editing ? (
        <>
          <Button
            className="visually-hidden page-turn-control page-turn-control--previous"
            aria-label={t("previousPage")}
            isDisabled={currentPage <= 1}
            onPress={() => requestPage("previous")}
          >
            {t("previousPage")}
          </Button>
          <Button
            className="visually-hidden page-turn-control page-turn-control--next"
            aria-label={t("nextPage")}
            isDisabled={currentPage >= document.numPages}
            onPress={() => requestPage("next")}
          >
            {t("nextPage")}
          </Button>
        </>
      ) : null}
    </section>
  );
}

export function ContinuousLayout({
  viewportName,
  document,
  currentPage,
  zoom,
  fitRequest = 0,
  navigationRequest = 0,
  onZoomChange,
  onPageChange,
  onToggleChrome,
  annotationProps,
}: Omit<ReaderLayoutProps, "onDismiss">) {
  const t = useMessages("reader");
  const pages = useMemo(() => new AnnotationPages(annotationProps.editor), [annotationProps.editor]);
  const pageSession = useSyncExternalStore(pages.subscribe, pages.getSnapshot);
  useEffect(() => pages.connect(), [pages]);
  useLayoutEffect(() => {
    if (annotationProps.editing && pages.getSnapshot().activePage === null) pages.activate(currentPage);
  }, [annotationProps.editing, currentPage, pages]);
  const onInteractionChange = annotationProps.onInteractionChange;
  useEffect(() => onInteractionChange(pageSession.interaction), [onInteractionChange, pageSession.interaction]);
  useEffect(() => () => onInteractionChange("idle"), [onInteractionChange]);
  const { scrollRef, contentRef, onScroll, geometryGestures, width, height, items, size } = useContinuousReaderLayout({
    document, currentPage, zoom, fitRequest, navigationRequest, viewportName,
    editing: annotationProps.editing,
    pinnedPages: annotationProps.editing ? pageSession.pinnedPages : [],
    onZoomChange, onPageChange,
    beforePageChange: annotationProps.editing ? () => annotationProps.editor!.prepareNavigation() : undefined,
    canCompletePage: annotationProps.editing ? annotationProps.editor?.canNavigate : undefined,
  });
  const gestureHandlers = useReaderGestures({
    containerRef: scrollRef,
    contentRef: contentRef,
    disabled: false,
    twoFingerOnly: annotationProps.editing,
    onNavigationStart: pages.interrupt,
    isObjectGestureActive: pages.ownsObjectGesture,
    zoom, onZoomChange, onTap: onToggleChrome,
    tapScope: document,
    tapRevision: `${currentPage}:${fitRequest}:${navigationRequest}:${size.width}:${size.height}`,
    gestureRevision: `${fitRequest}:${navigationRequest}:${size.width}:${size.height}`,
    ...geometryGestures,
  });

  return (
    <AnnotationPagesContext.Provider value={annotationProps.editing ? pages : null}>
    <section
      className="continuous-reader"
      data-current-page={currentPage}
      tabIndex={0}
      data-underfit={zoom < 1 || undefined}
      data-zoom={zoom}
      data-editing={annotationProps.editing || undefined}
      ref={scrollRef}
      {...gestureHandlers}
      onScroll={onScroll}
      aria-label={annotationProps.editing ? t("continuousEditing") : t("continuousReading")}
    >
      <div
        className="continuous-reader__inner"
        ref={contentRef}
        style={{
          width: width,
          height,
        }}
      >
        {items.map((item) => {
          const page = item.index + 1;
          return <div
            className="continuous-reader__page"
            key={item.index}
            data-index={item.index}
            style={{ transform: `translateY(${item.start}px)` }}
          >
            <AnnotatedPdfPage
              document={document}
              pageNumber={page}
              width={item.width}
              priority={item.priority}
              maxPixels={item.maxPixels}
              mode="continuous"
              aspectRatio={item.aspectRatio}
              annotationProps={annotationProps}
            />
          </div>;
        })}
      </div>
    </section>
    </AnnotationPagesContext.Provider>
  );
}

// Only paged reading uses a horizontal transition.
function pageTurnPresentation(pager: PagedReader, extent: number, slot = 0, top = 0, active = true) {
  return {
    "data-page-turn-phase": active ? pager.phase : "idle",
    "data-page-turn-progress": active ? pager.progress : 0,
    style: { "--page-turn-duration": `${PAGE_TURN_SETTLE_MS}ms`, transform: `translate3d(${active ? (pager.progress + slot) * extent : 0}px, ${top}px, 0)` } as CSSProperties,
    onTransitionEnd: (event: ReactTransitionEvent<HTMLDivElement>) => {
      if (active && slot === 0 && event.target === event.currentTarget && event.propertyName === "transform") pager.finishTransition();
    },
  };
}

function samplePageTurnAnimations(track: HTMLElement | null) {
  // Pointer tasks can arrive between animation ticks. Sample at the input
  // time rather than rebasing to the preceding main-thread frame while
  // the compositor has already advanced the transition.
  const timelineTime = window.document.timeline?.currentTime;
  if (typeof timelineTime === "number") {
    const elapsed = Math.max(0, performance.now() - timelineTime);
    for (const animation of track?.getAnimations?.({ subtree: true }) ?? []) {
      if (animation instanceof CSSTransition && animation.transitionProperty === "transform" && typeof animation.currentTime === "number") {
        animation.currentTime += elapsed;
      }
    }
  }
}

function useViewportPosition(ref: RefObject<HTMLElement | null>) {
  const [position, setPosition] = useState({ x: 0, y: 0 });
  useLayoutEffect(() => {
    const viewport = ref.current;
    if (!viewport) return;
    const update = () => {
      const x = viewport.scrollLeft, y = viewport.scrollTop;
      setPosition(previous => previous.x === x && previous.y === y ? previous : { x, y });
    };
    viewport.addEventListener("scroll", update);
    update();
    return () => { viewport.removeEventListener("scroll", update); };
  }, [ref]);
  return position;
}

export function PageNavigatorPanel({
  document,
  currentPage,
  onSelect,
  compact = false,
}: {
  document: PDFDocumentProxy;
  currentPage: number;
  onSelect(page: number): void;
  compact?: boolean;
}) {
  const t = useMessages("reader");
  const [gridOpen, setGridOpen] = useState(false);
  const [draftPage, setDraftPage] = useState<number | null>(null);
  const pendingPage = useRef(currentPage);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectRef = useRef(onSelect);
  useLayoutEffect(() => { selectRef.current = onSelect; }, [onSelect]);
  const page = draftPage ?? currentPage;
  const clearPending = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  const finish = () => {
    clearPending();
    selectRef.current(pendingPage.current);
    setDraftPage(null);
  };
  useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current); }, []);
  useEffect(() => {
    if (draftPage === null) return;
    // Native range controls own dragging, including release outside the track.
    const release = () => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
      selectRef.current(pendingPage.current);
      setDraftPage(null);
    };
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
      window.removeEventListener("blur", release);
    };
  }, [draftPage]);

  return (
    <>
      <DialogTrigger isOpen={gridOpen} onOpenChange={setGridOpen}>
        <Button className="reader-page-indicator" aria-label={t("openPageGrid", { page, numPages: document.numPages })}>
          <span aria-label={t("pageLocation")}>{page} / {document.numPages}</span><ChevronDown size={14} aria-hidden="true" />
        </Button>
        <ModalOverlay className="reader-panel-backdrop" isDismissable>
          <Modal className="reader-panel reader-page-grid-dialog">
            <Dialog aria-label={t("pageOverview")}>
              <header className="reader-panel__header"><strong>{t("pageOverview")}</strong>
                <Button className="icon-button" aria-label={t("closePageOverview")} onPress={() => setGridOpen(false)}><X size={21} aria-hidden="true" /></Button>
              </header>
              <ReaderPageGrid document={document} currentPage={currentPage} onSelect={page => { onSelect(page); setGridOpen(false); }} />
            </Dialog>
          </Modal>
        </ModalOverlay>
      </DialogTrigger>
      {!compact && <PagePreviewStrip document={document} page={page}
        onChange={next => {
          pendingPage.current = next;
          setDraftPage(next);
          clearPending();
          // Page numbers follow the finger immediately; expensive page rendering
          // waits for a short pause and never queues intermediate destinations.
          timer.current = setTimeout(() => {
            timer.current = null;
            selectRef.current(next);
          }, 120);
        }}
        onFinish={() => { if (draftPage !== null) finish(); }}
      />}
    </>
  );
}

// Mount the size observer with the strip it measures. Compact practice navigation
// has no strip; returning to normal reading creates a fresh measurement.
function PagePreviewStrip({ document, page, onChange, onFinish }: {
  document: PDFDocumentProxy;
  page: number;
  onChange(page: number): void;
  onFinish(): void;
}) {
  const t = useMessages("reader");
  const panelRef = useRef<HTMLElement>(null);
  const size = useElementSize(panelRef);
  useLayoutEffect(() => {
    const shell = panelRef.current?.closest<HTMLElement>(".reader-shell");
    if (!shell || !size.height) return;
    shell.style.setProperty("--reader-preview-height", `${panelRef.current!.getBoundingClientRect().height}px`);
    return () => { shell.style.removeProperty("--reader-preview-height"); };
  }, [size.height]);
  // Sample the document at a density that leaves gaps between resting thumbnails.
  // The range input still addresses every page, including those not sampled.
  const count = Math.min(document.numPages, 40, Math.max(1, Math.floor((size.width - 40) / 20) + 1));
  const activeIndex = document.numPages === 1 ? 0 : Math.round((page - 1) / (document.numPages - 1) * (count - 1));
  const thumbnails = Array.from({ length: count }, (_, index) =>
    count === 1 ? 1 : 1 + Math.round(index * (document.numPages - 1) / (count - 1)),
  );
  return (
    <nav className="page-preview-strip" aria-label={t("pageThumbnails")} ref={panelRef}
      style={{ width: `${42 + (Math.min(document.numPages, 40) - 1) * 20}px` }}>
      <div className="page-preview-strip__track" aria-hidden="true">
        {thumbnails.map((number, index) => (
          <div className="page-preview-strip__thumbnail" key={index}
            data-active={index === activeIndex || undefined}
            style={{ left: `${count === 1 ? 50 : index / (count - 1) * 100}%` }}>
            <PdfPageThumbnail document={document} pageNumber={index === activeIndex ? page : number} />
          </div>
        ))}
      </div>
      <input type="range" className="page-preview-strip__slider" aria-label={t("jumpToPage")}
        min={1} max={document.numPages} step={1} value={page}
        aria-valuetext={t("pagePositionOfTotal", { page, numPages: document.numPages })}
        disabled={document.numPages === 1}
        onChange={event => onChange(Number(event.target.value))}
        onKeyUp={onFinish}
        onBlur={onFinish}
      />
    </nav>
  );
}

function PdfPageThumbnail({
  document,
  pageNumber,
}: {
  document: PDFDocumentProxy;
  pageNumber: number;
}) {
  const aspectRatio = usePdfPageAspectRatio(document, pageNumber);
  return (
    <PdfPageCanvas
      presentation={false}
      className="pdf-thumbnail"
      document={document}
      pageNumber={pageNumber}
      width={42}
      aspectRatio={aspectRatio}
    />
  );
}

function AnnotatedPdfPage({
  document,
  pageNumber,
  width,
  fitViewport,
  turn,
  aspectRatio,
  annotationProps,
  onPageRenderStart,
  interactionRef,
  priority,
  maxPixels,
  mode,
}: {
  document: PDFDocumentProxy;
  pageNumber: number;
  width?: number;
  fitViewport?: { width: number; height: number };
  turn?: { position: number; progress: number };
  aspectRatio?: number;
  annotationProps: AnnotationPageProps;
  onPageRenderStart?(page: number): PdfPageRenderLease;
  interactionRef?: RefObject<AnnotationInteractionHandle | null>;
  priority?: number;
  maxPixels?: number;
  mode?: "continuous";
}) {
  const resolvedAspectRatio = usePdfPageAspectRatio(
    document,
    pageNumber,
    aspectRatio,
  );
  const renderedWidth = width ?? calculateFittedPageWidth(fitViewport!.width, fitViewport!.height, resolvedAspectRatio);
  return (
    <div
      className="annotated-pdf-page"
      style={{
        width: renderedWidth,
        height: renderedWidth / resolvedAspectRatio,
        // Enter at the paper edge, then arrive centered even when the target
        // has a different aspect ratio from the zoomed current page.
        transform: turn && fitViewport ? `translateX(${turn.position * (Math.abs(turn.progress) - 1) * Math.max(0, (fitViewport.width - renderedWidth) / 2)}px)` : undefined,
      }}
    >
      <PdfPageCanvas
        document={document}
        pageNumber={pageNumber}
        width={renderedWidth}
        aspectRatio={resolvedAspectRatio}
        onRenderStart={onPageRenderStart}
        priority={priority}
        maxPixels={maxPixels}
        mode={mode}
      />
      <Suspense fallback={null}>
        <AnnotationOverlay
          {...annotationProps}
          interactionRef={interactionRef}
          key={`${pageNumber}:${annotationProps.editing ? `edit:${annotationProps.activeLayerId}` : "read"}`}
          pageNumber={pageNumber}
          pageAspectRatio={resolvedAspectRatio}
        />
      </Suspense>
    </div>
  );
}
