
export const MAX_READER_ZOOM = 5;
export const FIT_ZOOM_TOLERANCE = 0.01;
export interface ReaderPoint { x: number; y: number }

// Committed positions use only the layout's native scroll range. Preview may
// leave that range, but must never create permanent translations or blank space.
export function placeReaderAnchor(container: HTMLElement, content: HTMLElement, resolve: () => ReaderPoint, center: ReaderPoint) {
  const anchor = resolve();
  const bounds = content.getBoundingClientRect();
  container.scrollLeft += bounds.left + anchor.x - center.x;
  container.scrollTop += bounds.top + anchor.y - center.y;
}

// Small paper is centered; large paper covers the viewport. Continuous reading
// may span pages vertically, while editing constrains movement to one page.
export function constrainReaderPosition(container: HTMLElement, paper: Pick<DOMRect, "left" | "top" | "width" | "height">, containPage = true) {
  const viewport = container.getBoundingClientRect();
  const correction = (start: number, extent: number, paperStart: number, paperExtent: number) =>
    paperExtent <= extent
      ? start + (extent - paperExtent) / 2 - paperStart
      : Math.min(0, start - paperStart) + Math.max(0, start + extent - paperStart - paperExtent);
  container.scrollLeft -= correction(viewport.left, viewport.width, paper.left, paper.width);
  if (containPage || paper.height <= viewport.height) {
    container.scrollTop -= correction(viewport.top, viewport.height, paper.top, paper.height);
  }
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
    bounds: () => paper.getBoundingClientRect(),
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
  };
}
