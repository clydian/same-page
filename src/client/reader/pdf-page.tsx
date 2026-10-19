import { foregroundDeadline, waitForForeground } from "./foreground-deadline";
import { pdfFailureCategory, pdfFailureReason, pdfEngineVersion, recordFailure } from "../diagnostics/diagnostics";
import { acquireRenderSlot, sizeRenderCanvas, releaseRenderCanvas, renderBudgetFacts, subscribeRenderBudget, hasRenderCapacity } from "./render-budget";
import type { PdfRenderFacts } from "../../shared/pdf-render-facts";
import { ReaderPresentationContext, usePagePresentation } from "./use-reader-presentation";
import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";

import type { PDFDocumentProxy } from "./pdf-document";
import { completeLoadingJourney } from "../performance/loading-performance";

export function PdfPageCanvas({
  document,
  pageNumber,
  width,
  aspectRatio = 0.707,
  className = "pdf-page-canvas",
  onRenderStart,
  presentation = true,
  priority,
  maxPixels,
  mode,
}: {
  document: PDFDocumentProxy;
  pageNumber: number;
  width: number;
  aspectRatio?: number;
  className?: string;
  onRenderStart?(pageNumber: number): PdfPageRenderLease;
  presentation?: boolean;
  priority?: number;
  maxPixels?: number;
  mode?: PdfRenderFacts["mode"];
}) {
  const renderPriority = priority ?? (presentation ? 0 : 2);
  const pixelLimit = maxPixels ?? (presentation ? 4 * 1024 * 1024 : 64 * 1024);
  const renderMode = mode ?? (presentation ? "paged" : "thumbnail");
  const retryDocument = useContext(ReaderPresentationContext)?.retryDocument;
  const automaticRetries = useRef(0);
  const automaticRetryPending = useRef(false);
  useLayoutEffect(() => { automaticRetries.current = 0; }, [document, pageNumber]);
  const [errorReason, setErrorReason] = useState<PdfRenderFacts["reason"] | null>(null);
  const [attempt, setAttempt] = useState(0);
  const canvasRefs = useRef<Array<HTMLCanvasElement | null>>([]);
  const frontCanvas = useRef(0);
  const currentDraw = useRef<{ canvas: HTMLCanvasElement; cancel(): void } | null>(null);
  const source = useRef({ document, pageNumber });
  const renderLease = useRef<PdfPageRenderLease | null>(null);
  const [painted, setPainted] = useState<{ canvas: number; document: PDFDocumentProxy; pageNumber: number } | null>(null);
  const visibleCanvas = painted?.canvas ?? null;
  const [error, setError] = useState(false);

  const reportFailure = usePagePresentation(document, pageNumber, painted, error, presentation);
  // A retry uses fresh backing stores, including when the browser never restores
  // a lost context. Do not expose an old bitmap identity on the new elements.
  const retry = useCallback(() => {
    setPainted(null);
    setError(false);
    setErrorReason(null);
    setAttempt(value => value + 1);
  }, []);

  const autoRetry = useCallback(() => {
    if (automaticRetries.current >= 2 || automaticRetryPending.current) return;
    automaticRetryPending.current = true;
    automaticRetries.current++;
    retry();
  }, [retry]);
  // Only resource failures retry themselves. A real PDF/decode failure remains
  // manual, and repeated context loss cannot run a retry loop.
  useEffect(() => {
    if (!errorReason || automaticRetries.current >= 2) return;
    if (errorReason === "budget") {
      const resume = () => { if (globalThis.document.visibilityState !== "hidden" && hasRenderCapacity()) autoRetry(); };
      const unsubscribe = subscribeRenderBudget(resume);
      globalThis.document.addEventListener("visibilitychange", resume);
      window.addEventListener("pageshow", resume);
      resume();
      return () => { unsubscribe(); globalThis.document.removeEventListener("visibilitychange", resume); window.removeEventListener("pageshow", resume); };
    }
    if (errorReason === "context-lost" || errorReason === "canvas-unavailable") {
      return foregroundDeadline(autoRetry, 250);
    }
  }, [errorReason, autoRetry, attempt]);
  const recordPageFailure = useCallback((reason: PdfRenderFacts["reason"], error: unknown) => {
    recordFailure({ operation: "pdf", category: pdfFailureCategory(error), stage: "decode",
      pdfReason: pdfFailureReason(error, true), engineVersion: pdfEngineVersion,
      render: { reason, page: pageNumber, pageCount: document.numPages, mode: renderMode,
        width: Math.min(32768, Math.max(0, Math.round(width))), devicePixelRatio: Math.min(16, window.devicePixelRatio || 1),
        priority: renderPriority, maxPixels: Math.round(pixelLimit), ...renderBudgetFacts(), automaticRetries: automaticRetries.current } });
    setErrorReason(reason);
  }, [document, pageNumber, width, renderMode, renderPriority, pixelLimit]);

  useLayoutEffect(() => {
    const lease = onRenderStart?.(pageNumber) ?? null;
    renderLease.current = lease;
    return () => {
      if (renderLease.current === lease) renderLease.current = null;
      lease?.cancel();
    };
  }, [document, onRenderStart, pageNumber, width]);

  useLayoutEffect(() => {
    if (visibleCanvas === null) return;
    const previous = canvasRefs.current[1 - visibleCanvas];
    if (!previous) return;
    releaseRenderCanvas(previous);
  }, [visibleCanvas]);

  useLayoutEffect(() => { const canvases = [...canvasRefs.current]; return () => { canvases.forEach(canvas => { if (canvas) releaseRenderCanvas(canvas); }); }; }, [attempt]);

  useEffect(() => {
    const canvases = canvasRefs.current.filter((canvas): canvas is HTMLCanvasElement => canvas !== null);
    const lost = new Set<HTMLCanvasElement>();
    const onLost = (event: Event) => {
      const canvas = event.currentTarget as HTMLCanvasElement;
      if (lost.has(canvas)) return;
      lost.add(canvas);
      if (canvas !== canvasRefs.current[frontCanvas.current] && canvas !== currentDraw.current?.canvas) return;
      // Invalidate synchronously: React effect cleanup can run after a queued
      // render Promise, which must never publish the lost backing store.
      currentDraw.current?.cancel();
      const error = new Error("canvas_context_lost");
      recordPageFailure("context-lost", error);
      canvases.forEach(releaseRenderCanvas);
      setPainted(null);
      setError(true);
      reportFailure(error);
      renderLease.current?.failed?.();
    };
    const onRestored = (event: Event) => {
      const canvas = event.currentTarget as HTMLCanvasElement;
      if (lost.delete(canvas) && (canvas === canvasRefs.current[frontCanvas.current] || canvas === currentDraw.current?.canvas)) autoRetry();
    };
    canvases.forEach(canvas => {
      canvas.addEventListener("contextlost", onLost);
      canvas.addEventListener("contextrestored", onRestored);
    });
    return () => canvases.forEach(canvas => {
      canvas.removeEventListener("contextlost", onLost);
      canvas.removeEventListener("contextrestored", onRestored);
    });
  }, [attempt, reportFailure, autoRetry, recordPageFailure]);

  useEffect(() => {
    automaticRetryPending.current = false;
    const sourceChanged =
      source.current.pageNumber !== pageNumber || source.current.document !== document;
    source.current = { document, pageNumber };
    const previousFront = frontCanvas.current;
    const nextFront = 1 - previousFront;
    const canvas = canvasRefs.current[nextFront];
    if (!canvas || width <= 0) {
      return;
    }
    if (sourceChanged) {
      setPainted(null);
    }
    let active = true;
    let cancelRender: (() => void) | undefined;
    const lease = renderLease.current;

    const abort = new AbortController();
    const drawingLease = { canvas, cancel: () => {
      active = false;
      abort.abort();
      cancelRender?.();
    } };
    currentDraw.current = drawingLease;
    const draw = async () => {
      await waitForForeground(abort.signal);
      const release = await acquireRenderSlot(abort.signal, renderPriority);
      try {
        for (let resolution = 1; resolution >= 0.5; resolution /= 2) {
          let drawing = true;
          let onAbort: (() => void) | undefined;
          let cancelDeadline: (() => void) | undefined;
          try {
            await Promise.race([
              (async () => {
                const page = await document.getPage(pageNumber);
                await waitForForeground(abort.signal);
                abort.signal.throwIfAborted();
                if (!drawing) throw new DOMException("cancelled", "AbortError");
                const unscaled = page.getViewport({ scale: 1 });
                const pixels = width * Math.min(window.devicePixelRatio || 1, 2) * resolution;
                sizeRenderCanvas(canvas, pixels, pixels * unscaled.height / unscaled.width, pixelLimit);
                const context = canvas.getContext("2d", { alpha: false });
                if (!context) throw new Error("canvas_unavailable");
                const viewport = page.getViewport({ scale: canvas.width / unscaled.width });
                const task = page.render({ canvas, canvasContext: context, viewport });
                cancelRender = () => task.cancel();
                return task.promise;
              })(),
              new Promise<never>((_, reject) => {
                onAbort = () => reject(abort.signal.reason);
                abort.signal.addEventListener("abort", onAbort, { once: true });
                cancelDeadline = foregroundDeadline(() => reject(Object.assign(new Error("page_render_timeout"), { name: "TimeoutError" })), 20_000);
              }),
            ]);
            return;
          } catch (error) {
            cancelRender?.();
            if (abort.signal.aborted || resolution === 0.5 || (error instanceof Error && error.name === "TimeoutError")) throw error;
          } finally { drawing = false; if (onAbort) abort.signal.removeEventListener("abort", onAbort); cancelDeadline?.(); }
        }
      } finally { release(); }
    };
    void draw()
      .then(() => {
        if (!active) return;
        if (currentDraw.current === drawingLease) currentDraw.current = null;
        frontCanvas.current = nextFront;
        setPainted({ canvas: nextFront, document, pageNumber });
        setError(false);
        lease?.ready();
        window.requestAnimationFrame(() => {
          completeLoadingJourney("open-score", "first-canvas-visible");
        });
      })
      .catch((reason: unknown) => {
        if (active && !(reason instanceof Error && reason.name === "RenderingCancelledException")) {
          const kind = reason instanceof Error && reason.message === "canvas_memory_budget" ? "budget"
            : reason instanceof Error && reason.message === "canvas_unavailable" ? "canvas-unavailable"
            : reason instanceof Error && reason.name === "TimeoutError" ? "timeout" : "page-failed";
          recordPageFailure(kind, reason);
          // A failed back buffer has no useful bitmap; return its reservation.
          releaseRenderCanvas(canvas);
          setError(true);
          reportFailure(reason instanceof Error && reason.name === "Error" && pdfFailureCategory(reason) === "internal" ? Object.assign(new Error("pdf_page_render_failed"), { name: "PdfPageRenderError" }) : reason);
          lease?.failed?.();
        }
      });

    return () => {
      drawingLease.cancel();
      if (currentDraw.current === drawingLease) currentDraw.current = null;
    };
  }, [document, onRenderStart, pageNumber, width, attempt, reportFailure, renderPriority, pixelLimit, recordPageFailure]);

  return (
    <div
      className={`${className}${error ? " pdf-page-canvas--error" : ""}`}
      data-page-number={pageNumber}
      role={error ? undefined : "img"}
      aria-label={error ? undefined : `第 ${pageNumber} 页`}
      style={{
        width: `${Math.max(1, width)}px`,
        height: `${Math.max(1, width / Math.max(0.001, aspectRatio))}px`,
      }}
    >
      {[0, 1].map((index) => (
        <canvas
          aria-hidden="true"
          data-pdf-canvas-active={index === visibleCanvas ? "" : undefined}
          hidden={index !== visibleCanvas}
          key={`${attempt}-${index}`}
          ref={(node) => {
            canvasRefs.current[index] = node;
          }}
        />
      ))}
      {error ? <div className="page-render-recovery"><p role="alert">这一页暂时无法显示</p><button onClick={() => { automaticRetries.current = 0; retry(); }}>重试本页</button>{presentation && retryDocument && <button onClick={retryDocument}>重新加载 PDF</button>}</div> : null}
    </div>
  );
}

export interface PdfPageRenderLease {
  ready(): void;
  failed?(): void;
  cancel(): void;
}
