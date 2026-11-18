import { getCurrentLocale, getMessages, type AppLocale } from "../../i18n";
import type { OfflineScoreRecord } from "../platform/local-database";
import type { OfflinePreparationState } from "./offline-score";

// Preparing a replacement and possessing verified bytes are independent facts.
export function offlinePreparationDescription(preparation: OfflinePreparationState, copy: { record: OfflineScoreRecord | null; invalid: boolean; readFailed?: boolean } | null | undefined, versionId: string, locale: AppLocale = getCurrentLocale()) {
  const t = getMessages(locale, "reader");
  if (copy?.readFailed) return t("retryOfflineRead");
  if (preparation.phase === "preparing") return t("preparingOffline");
  if (preparation.phase === "failed") {
    if (preparation.reason === "timeout") return t("offlineTimedOut");
    if (preparation.reason === "annotations") return t("offlineAccessUnverified");
    if (preparation.reason === "identity") return t("offlineNeedsSignIn");
    return copy ? offlineDownloadFailure(t, copy.record, versionId, copy.invalid) : t("offlineCopyUnconfirmed");
  }
  return copy ? offlineScoreLabel(t, copy.record, versionId, copy.invalid) : t("verifyingOfflineCopy");
}

function offlineScoreLabel(t: ReturnType<typeof getMessages>, record: OfflineScoreRecord | null, currentVersionId: string, invalid = false) {
  if (invalid) return t("invalidOfflineCopy");
  if (!record) return t("offlineNotSaved");
  return record.versionId === currentVersionId ? t("offlineAvailable") : t("olderOfflineCopyAvailable");
}

function offlineDownloadFailure(t: ReturnType<typeof getMessages>, record: OfflineScoreRecord | null, currentVersionId: string, invalid = false) {
  if (invalid || !record) return t("onlineRetryRequired");
  if (record.versionId !== currentVersionId) return t("olderOfflineCopyRetained");
  return t("currentOfflineCopyRetained");
}
