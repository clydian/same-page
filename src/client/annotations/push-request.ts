import type { AnnotationOutboxRecord } from "../platform/local-database";

// A soft request budget: a larger single legal operation must still make progress.
export const annotationPushMaxBytes = 512_000;

export function toWireOperation(operation: AnnotationOutboxRecord) {
  return {
    opId: operation.opId,
    annotationId: operation.annotationId,
    layerId: operation.layerId,
    baseVersion: operation.baseVersion,
    type: operation.type,
    payload: operation.payload,
  };
}
