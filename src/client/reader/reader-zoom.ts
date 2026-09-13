import { calculateFittedPageWidth } from "./reader-dimensions";

export const MAX_READER_ZOOM = 5;
export const FIT_ZOOM_TOLERANCE = 0.01;
export interface ReaderPoint { x: number; y: number }

// These offsets retain the part of an anchored zoom that native scroll cannot
// represent (notably a narrow page's horizontal position). They belong to the
// mounted viewport, never to saved notes or reading preferences.
export function readerOffset(content: HTMLElement | null): ReaderPoint {
  return {
    x: Number(content?.style.getPropertyValue("--reader-anchor-x").replace("px", "")) || 0,
    y: Number(content?.style.getPropertyValue("--reader-anchor-y").replace("px", "")) || 0,
  };
}
export function setReaderOffset(content: HTMLElement, point: ReaderPoint) {
  content.style.setProperty("--reader-anchor-x", `${point.x}px`);
  content.style.setProperty("--reader-anchor-y", `${point.y}px`);
}
export function resetReaderOffset(content: HTMLElement | null) {
  if (content) setReaderOffset(content, { x: 0, y: 0 });
}

export function placeReaderAnchor(container: HTMLElement, content: HTMLElement, resolve: () => ReaderPoint, center: ReaderPoint) {
  // Scroll first, then retain the residual, including subpixel scroll rounding.
  const anchor = resolve();
  const bounds = content.getBoundingClientRect();
  container.scrollLeft += bounds.left + anchor.x - center.x;
  container.scrollTop += bounds.top + anchor.y - center.y;
  const after = content.getBoundingClientRect();
  const offset = readerOffset(content);
  setReaderOffset(content, {
    x: offset.x + center.x - after.left - anchor.x,
    y: offset.y + center.y - after.top - anchor.y,
  });
  container.dispatchEvent(new Event("reader-viewport-position"));
}

// Resolve against the actual paper after layout, not a scaled list rectangle:
// centering gutters and the fixed page gaps do not scale with the PDF.
export function capturePaperAnchor(content: HTMLElement, center: ReaderPoint) {
  const papers = [...content.querySelectorAll<HTMLElement>(".annotated-pdf-page")];
  let paper: HTMLElement | undefined;
  let nearest = Infinity;
  for (const candidate of papers) {
    if (candidate.closest('[data-edit-hidden="true"], [data-page-turn-target="true"]')) continue;
    const r = candidate.getBoundingClientRect();
    const distance = Math.max(r.top - center.y, 0, center.y - r.bottom);
    // Equal-distance gaps belong to the earlier page; side gutters to the
    // page sharing their vertical span. Keep this page through the gesture.
    if (distance < nearest) { paper = candidate; nearest = distance; }
  }
  if (!paper) return null;
  const initial = paper.getBoundingClientRect();
  const u = (center.x - initial.left) / Math.max(1, initial.width);
  const v = (center.y - initial.top) / Math.max(1, initial.height);
  const resolvePoint = (x: number, y: number) => {
    const bounds = content.getBoundingClientRect();
    const r = paper.getBoundingClientRect();
    return { x: r.left - bounds.left + r.width * x, y: r.top - bounds.top + r.height * y };
  };
  return {
    ratio: initial.width / Math.max(1, initial.height),
    resolve: () => resolvePoint(u, v),
    resolveCenter: () => resolvePoint(0.5, 0.5),
  };
}

export function doubleTapZoomTarget(container: HTMLElement, content: HTMLElement, center: ReaderPoint, zoom: number, continuous: boolean) {
  const anchor = capturePaperAnchor(content, center);
  if (!anchor) return null;
  const fitted = continuous
    ? calculateFittedPageWidth(container.clientWidth, container.clientHeight, anchor.ratio) / Math.max(1, container.clientWidth)
    : 1;
  const restore = zoom > fitted * (1 + FIT_ZOOM_TOLERANCE);
  const viewport = container.getBoundingClientRect();
  return {
    zoom: restore ? fitted : Math.min(MAX_READER_ZOOM, fitted * 2),
    center: restore ? { x: viewport.left + viewport.width / 2, y: viewport.top + viewport.height / 2 } : center,
    resolveAnchor: restore ? anchor.resolveCenter : anchor.resolve,
    restore,
  };
}
