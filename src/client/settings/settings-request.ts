import { getCurrentLocale, getMessages } from "../../i18n";
export class SettingsRequestError extends Error {
  constructor(readonly status: number, readonly code?: string) {
    super("settings_request_failed");
  }
}

export async function settingsResponse(response: Response) {
  if (!response.ok) throw new SettingsRequestError(response.status);
  return response.json() as Promise<unknown>;
}

export function settingsError(error: unknown, fallback: string) {
  const t = getMessages(getCurrentLocale(), "library");
  if (error instanceof SettingsRequestError) {
    if (error.status === 401) return t("driveLibraryLoginHasExpiredLog");
    if (error.status === 403) return t("settingsRequestDoNotPermissionOperate");
  }
  return fallback;
}

// These responses invalidate remembered display data for this endpoint.
export function isSettingsReadDenied(error: unknown) {
  return error instanceof SettingsRequestError && [401, 403, 404].includes(error.status);
}
