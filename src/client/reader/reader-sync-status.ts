import { getCurrentLocale, getMessages, type AppLocale } from "../../i18n";
import type { AnnotationConflictRecord } from "../platform/local-database";

export type ReaderSyncOutcome =
  | "none"
  | "local-draft"
  | "local-saved"
  | "synced"
  | "failed"
  | "trash-preserved"
  | "conflict-changed"
  | "conflict-discarded"
  | "conflict-reapplied";

export type ReaderSyncStatusKind =
  | "quiet"
  | "draft"
  | "pending"
  | "syncing"
  | "failed"
  | "conflict"
  | "risk";

export interface ReaderSyncStatus {
  kind: ReaderSyncStatusKind;
  message: string | null;
}

export function deriveReaderSyncStatus({
  outcome, syncing, pendingCount, conflictCount, syncErrorCount,
  loaded = false, draftCount = 0, acceptedCount = 0, online = true,
  permissionErrorCount = 0, localOnly = false,
}: {
  localOnly?: boolean;
  outcome: ReaderSyncOutcome;
  syncing: boolean;
  pendingCount: number;
  conflictCount: number;
  syncErrorCount: number;
  loaded?: boolean;
  draftCount?: number;
  acceptedCount?: number;
  online?: boolean;
  permissionErrorCount?: number;
}, locale: AppLocale = getCurrentLocale()): ReaderSyncStatus {
  const t = getMessages(locale, "reader");
  if (outcome === "trash-preserved") return { kind: "risk", message: t("trashedSyncPaused") };
  if (!loaded) return { kind: "risk", message: t("annotationStateUnknown") };
  if (localOnly) return { kind: outcome === "failed" ? "failed" : "quiet", message: outcome === "failed" ? t("localActionFailed") : t("localPreviewNotesOnly") };
  if (conflictCount > 0) return { kind: "conflict", message: t("pendingConflicts", { conflictCount }) };
  if (permissionErrorCount > 0) return { kind: "failed", message: t("syncBlockedByPermission", { permissionErrorCount }) };
  if (syncErrorCount > 0 || outcome === "failed") return { kind: "failed", message: t("syncFailed") };
  if (syncing) return { kind: "syncing", message: pendingCount > 0 ? t("syncingChanges", { pendingCount }) : t("checkingCloudNotes") };
  if (pendingCount > 0 || draftCount > 0) return {
    kind: "pending",
    message: !online ? t("savedWaitingForConnection") : draftCount > 0 ? t("savedWaitingForEditing") : t("savedWaitingForSync", { pendingCount }),
  };
  // A completed request, empty query or network connection is not acceptance.
  if (acceptedCount > 0) return { kind: "quiet", message: t("noPendingUploads") };
  return { kind: "quiet", message: t("noChangesYet") };
}

export function describeAnnotationConflict(
  conflict: AnnotationConflictRecord,
  layerName: string,
) {
  const t = getMessages(getCurrentLocale(), "reader");
  const payload = conflict.localPayload ?? conflict.canonical?.payload ?? null;
  const pageNumber = payload?.pageNumber ?? 1;
  let summary = t("noteContent");
  if (conflict.localDeleted) {
    summary = t("deleteNote");
  } else if (payload?.kind === "text") {
    summary = truncateSummary(payload.text);
  } else if (payload?.kind === "ink") {
    summary = t("strokePointCount", { count: payload.points.length });
  }
  return { pageNumber, layerName, summary };
}

function truncateSummary(value: string) {
  const t = getMessages(getCurrentLocale(), "reader");
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return t("emptyTextNote");
  return normalized.length > 28 ? `${normalized.slice(0, 28)}…` : normalized;
}
