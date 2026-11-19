import { getCurrentLocale, getMessages } from "../../i18n";
import { trialMessage } from "../drives/trial-messages";
export function formatBytes(bytes: number) {
  if (bytes >= 1024 ** 3) return `${Number((bytes / 1024 ** 3).toFixed(1))} GB`;
  if (bytes < 1024 * 1024) return `${Math.max(0, bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function uploadMessage(status: number, payload: unknown) {
  const t = getMessages(getCurrentLocale(), "library");
  const error = (payload as { error?: string } | null)?.error;
  if (status === 413 || error === "pdf_too_large") return t("libraryFormatPdfOverMb");
  if (error === "pdf_resource_limit") return t("libraryFormatPdfExceedsParsingResource");
  if (error === "version_conflict") return t("libraryFormatCurrentPdfHasChanged");
  if (error === "encrypted_pdf") return t("libraryFormatEncryptedPdfCannotUploaded");
  if (error === "invalid_pdf") return t("libraryFormatPdfCorruptedCannotParsed");
  if (error === "filename_conflict") {
    return t("libraryFormatFileLibraryAlreadyHas");
  }
  if (error === "invalid_file_name") return t("libraryFormatFileNameInvalid");
  if (error === "storage_quota_exceeded") return t("libraryFormatThereInsufficientRemainingSpace");
  if (error === "platform_storage_limit_reached" || error === "score_limit_reached" || error === "try_again_later" || error === "resource_deleted") return trialMessage(error);
  if (error === "replacement_in_progress") return t("libraryFormatAnotherPdfReplacementProgress");
  return t("libraryFormatOperationNotCompletedExisting");
}
