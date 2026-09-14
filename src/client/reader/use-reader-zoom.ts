import { type RefObject, useCallback, useLayoutEffect, useRef } from "react";
import {
  capturePaperAnchor, doubleTapZoomTarget, MAX_READER_ZOOM,
  placeReaderAnchor, constrainReaderPosition, type ReaderPoint,
} from "./reader-zoom";

export type ReaderZoomOutcome = { status: "committed"; zoomChanged: boolean } | { status: "cancelled" };
export interface ReaderZoomGeometry {
  capture(center: ReaderPoint): {
    anchor: ReturnType<typeof capturePaperAnchor>;
    release(outcome: ReaderZoomOutcome): void;
  };
  constrain(): void;
}
export interface ReaderZoomGesture {
  update(center: ReaderPoint, scale: number): void;
  finish(): void;
}
interface ZoomPreview {
  zoom: number;
  scale: number;
  offset: ReaderPoint;
  center: ReaderPoint;
  resolve(): ReaderPoint;
}
interface ZoomSession {
  scope: unknown;
  revision: string | undefined;
  mode: boolean;
  disabled: boolean;
  navigation: unknown;
  container: HTMLElement;
  content: HTMLElement;
  presentation: HTMLElement | null;
  sourceZoom: number;
  preview: ZoomPreview | null;
  pending: ZoomPreview | null;
  release(outcome: ReaderZoomOutcome): void;
  constrain(): void;
}

// Own the whole handoff, including the layout commit. Input only supplies a
// scale/center and a release; it never sequences positioning or lease cleanup.
export function useReaderZoom({ containerRef, contentRef, previewBoundaryRef,
  zoom, onZoomChange, geometry, continuous, scope, revision,
  mode, disabled, navigation,
}: {
  containerRef: RefObject<HTMLElement | null>;
  contentRef: RefObject<HTMLElement | null>;
  previewBoundaryRef?: RefObject<HTMLElement | null>;
  zoom: number;
  onZoomChange(zoom: number): void;
  geometry?: ReaderZoomGeometry;
  continuous: boolean;
  scope: unknown;
  revision?: string;
  mode: boolean;
  disabled: boolean;
  navigation: unknown;
}) {
  const active = useRef<ZoomSession | null>(null);
  const cancel = useCallback(() => {
    const session = active.current;
    if (!session) return;
    active.current = null;
    clearPreview(session);
    session.release({ status: "cancelled" });
  }, []);

  const complete = (session: ZoomSession, target: ZoomPreview) => {
    if (active.current !== session) return;
    clearPreview(session);
    placeReaderAnchor(session.container, session.content, target.resolve, target.center);
    session.constrain();
    active.current = null;
    session.release({ status: "committed", zoomChanged: Math.abs(target.zoom - session.sourceZoom) > 0.001 });
  };

  useLayoutEffect(() => {
    const session = active.current;
    if (!session) return;
    // Invalidation must precede numeric zoom matching in the SAME effect. A
    // replacement document can legitimately render the old requested zoom.
    if (session.scope !== scope || session.revision !== revision || session.mode !== mode ||
      session.disabled !== disabled || session.navigation !== navigation ||
      session.container !== containerRef.current || session.content !== contentRef.current) {
      cancel();
      return;
    }
    if (session.pending && Math.abs(session.pending.zoom - zoom) < 0.001) {
      complete(session, session.pending);
    } else if (Math.abs(session.sourceZoom - zoom) > 0.001) {
      // A controlled zoom changed independently (for example, the toolbar).
      cancel();
    }
  });
  useLayoutEffect(() => cancel, [cancel]);

  const start = (center: ReaderPoint) => {
    cancel();
    const container = containerRef.current, content = contentRef.current;
    if (disabled || !container || !content) return null;
    const lease = geometry?.capture(center);
    const anchor = lease ? lease.anchor : capturePaperAnchor(content, center);
    const session: ZoomSession = {
      scope, revision, mode, disabled, navigation, container, content,
      presentation: previewBoundaryRef?.current ?? null,
      sourceZoom: zoom, preview: null, pending: null,
      release: outcome => lease?.release(outcome),
      constrain: () => {
        if (anchor) constrainReaderPosition(container, anchor.bounds(), !continuous);
        geometry?.constrain();
      },
    };
    active.current = session;
    return { session, anchor };
  };
  const commit = (session: ZoomSession, target: ZoomPreview, preview: boolean) => {
    if (active.current !== session) return;
    if (Math.abs(target.zoom - session.sourceZoom) < 0.001) {
      complete(session, target);
      return;
    }
    if (preview) paintPreview(session, target);
    session.pending = target;
    onZoomChange(target.zoom);
  };

  return {
    cancel,
    begin(center: ReaderPoint): ReaderZoomGesture | null {
      const started = start(center);
      if (!started) return null;
      const { session, anchor } = started;
      // Fit the captured page, which can differ from the viewport-center page
      // in a continuous document with mixed page sizes.
      const minimumZoom = anchor && session.content.classList.contains("continuous-reader__inner")
        ? Math.min(1, session.container.clientHeight * anchor.ratio / Math.max(1, session.container.clientWidth))
        : 1;
      const bounds = session.content.getBoundingClientRect();
      const scroll = { x: session.container.scrollLeft, y: session.container.scrollTop };
      const point = { x: center.x - bounds.left, y: center.y - bounds.top };
      const ratio = { x: clamp(point.x / Math.max(1, bounds.width), 0, 1), y: clamp(point.y / Math.max(1, bounds.height), 0, 1) };
      const resolve = () => {
        if (anchor) return anchor.resolve();
        const current = session.content.getBoundingClientRect();
        return { x: current.width * ratio.x, y: current.height * ratio.y };
      };
      return {
        update(center, scale) {
          if (active.current !== session || session.pending) return;
          const nextZoom = clamp(session.sourceZoom * scale, Math.min(0.75, minimumZoom * 0.75), MAX_READER_ZOOM);
          scale = nextZoom / session.sourceZoom;
          const next = {
            zoom: nextZoom, scale, center, resolve,
            offset: {
              x: center.x - bounds.left - point.x * scale + session.container.scrollLeft - scroll.x,
              y: center.y - bounds.top - point.y * scale + session.container.scrollTop - scroll.y,
            },
          };
          session.preview = next;
          paintPreview(session, next);
        },
        finish() {
          if (active.current !== session || session.pending) return;
          const preview = session.preview;
          if (!preview) { cancel(); return; }
          const settledZoom = clamp(preview.zoom, minimumZoom, MAX_READER_ZOOM);
          commit(session, { ...preview, zoom: settledZoom, scale: settledZoom / session.sourceZoom }, true);
        },
      };
    },
    doubleTap(center: ReaderPoint) {
      const started = start(center);
      if (!started) return;
      const { session, anchor } = started;
      if (!anchor) { cancel(); return; }
      const target = doubleTapZoomTarget(session.container, anchor, center, zoom, continuous);
      commit(session, { ...target, resolve: target.resolveAnchor, scale: target.zoom / zoom, offset: { x: 0, y: 0 } }, false);
    },
  };
}

function clearPreview(session: ZoomSession) {
  session.presentation?.removeAttribute("data-gesture-preview");
  session.content.style.removeProperty("--reader-gesture-scale");
  session.content.style.removeProperty("--reader-gesture-x");
  session.content.style.removeProperty("--reader-gesture-y");
  session.content.removeAttribute("data-gesture-preview");
}
function paintPreview(session: ZoomSession, next: ZoomPreview) {
  session.presentation?.setAttribute("data-gesture-preview", "");
  session.content.style.setProperty("--reader-gesture-scale", String(next.scale));
  session.content.style.setProperty("--reader-gesture-x", `${next.offset.x}px`);
  session.content.style.setProperty("--reader-gesture-y", `${next.offset.y}px`);
  session.content.setAttribute("data-gesture-preview", "");
}
function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
