import type { AnnotationLayerSummary } from "../../shared/annotations";

// Personal layers appear as writable for their author and read-only for members they are shared with.
export function groupReaderLayers(layers: readonly AnnotationLayerSummary[]) {
  const shared: AnnotationLayerSummary[] = [];
  const personal: AnnotationLayerSummary[] = [];
  const memberShares: AnnotationLayerSummary[] = [];
  for (const layer of layers) {
    if (layer.kind === "shared") {
      shared.push(layer);
    } else if (layer.kind === "personal") {
      (layer.canEdit ? personal : memberShares).push(layer);
    }
  }
  return { shared, personal, memberShares };
}
