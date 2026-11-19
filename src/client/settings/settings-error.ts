import { getCurrentLocale, getMessages } from "../../i18n";
import { SettingsRequestError } from "./settings-request";

export function settingsError(error: unknown, fallback: string) {
  const t = getMessages(getCurrentLocale(), "library");
  if (error instanceof SettingsRequestError) {
    if (error.status === 401) return t("driveLibraryLoginHasExpiredLog");
    if (error.status === 403) return t("settingsRequestDoNotPermissionOperate");
  }
  return fallback;
}
