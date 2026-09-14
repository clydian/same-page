
export const MAX_READER_ZOOM = 5;
export const FIT_ZOOM_TOLERANCE = 0.01;
export interface ReaderPoint { x: number; y: number }

// These offsets retain the part of an anchored zoom that native scroll cannot
// represent (notably a narrow page's horizontal position). They belong to the
// mounted viewport, never to saved notes or reading preferences.
function continuous(content: HTMLElement | null) { return content?.classList.contains("continuous-reader__inner") ?? false; }
function pixels(content: HTMLElement | null, property: string) {
  return Number(content?.style.getPropertyValue(property).replace("px", "")) || 0;
}
function notifyPosition(content: HTMLElement) {
  content.closest(".continuous-reader, .page-reader__viewport")?.dispatchEvent(new Event("reader-viewport-position"));
}
export function readerOffset(content: HTMLElement | null): ReaderPoint {
  return { x: pixels(content, "--reader-anchor-x"), y: pixels(content, continuous(content) ? "--reader-anchor-before" : "--reader-anchor-y") };
}
export function setReaderOffset(content: HTMLElement, point: ReaderPoint) {
  content.style.setProperty("--reader-anchor-x", `${point.x}px`);
  content.style.setProperty(continuous(content) ? "--reader-anchor-before" : "--reader-anchor-y", `${point.y}px`);
  notifyPosition(content);
}
export function resetReaderOffset(content: HTMLElement | null) {
  if (!content) return;
  content.style.removeProperty("--reader-anchor-after");
  setReaderOffset(content, { x: 0, y: 0 });
}

export function placeReaderAnchor(container: HTMLElement, content: HTMLElement, resolve: () => ReaderPoint, center: ReaderPoint) {
  const anchor = resolve();
  const bounds = content.getBoundingClientRect();
  container.scrollLeft += bounds.left + anchor.x - center.x;
  let top = container.scrollTop + bounds.top + anchor.y - center.y;
  if (continuous(content)) {
    // Give native scrolling real room at both ends. A negative translateY
    // would make the document's start unreachable when scrollTop returns to 0.
    if (top < 0) {
      const offset = readerOffset(content);
      setReaderOffset(content, { ...offset, y: offset.y - top });
      top = 0;
    }
    const overflow = top - (container.scrollHeight - container.clientHeight);
    if (overflow > 0) content.style.setProperty("--reader-anchor-after", `${pixels(content, "--reader-anchor-after") + Math.ceil(overflow)}px`);
  }
  container.scrollTop = top;
  const after = content.getBoundingClientRect();
  const offset = readerOffset(content);
  setReaderOffset(content, {
    x: offset.x + center.x - after.left - anchor.x,
    y: continuous(content) ? offset.y : offset.y + center.y - after.top - anchor.y,
  });
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
    pageIndex: Number(paper.closest<HTMLElement>("[data-index]")?.dataset.index ?? 0),
    ratio: initial.width / Math.max(1, initial.height),
    resolve: () => resolvePoint(u, v),
    resolveCenter: () => resolvePoint(0.5, 0.5),
  };
}

export function doubleTapZoomTarget(container: HTMLElement, anchor: NonNullable<ReturnType<typeof capturePaperAnchor>>, center: ReaderPoint, zoom: number, continuous: boolean) {
  // Each layout's 100% is its reading baseline: fit-width for continuous,
  // fit-page for paged. A default continuous view must enlarge on first tap.
  const fitted = 1;
  const restore = zoom > fitted * (1 + FIT_ZOOM_TOLERANCE);
  const viewport = container.getBoundingClientRect();
  return {
    zoom: restore ? fitted : Math.min(MAX_READER_ZOOM, fitted * 2),
    center: restore ? { x: viewport.left + viewport.width / 2, y: continuous ? center.y : viewport.top + viewport.height / 2 } : center,
    resolveAnchor: restore ? () => ({
      x: anchor.resolveCenter().x,
      y: continuous ? anchor.resolve().y : anchor.resolveCenter().y,
    }) : anchor.resolve,
    restore,
  };
}
