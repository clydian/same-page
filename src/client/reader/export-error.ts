import { getMessages, sourceLocale } from "../../i18n";

type ExportErrorMessage =
  | "exportCanvasFailed"
  | "exportSignInRequired"
  | "exportOfflineNotesMissing"
  | "exportLayersUnavailable"
  | "exportPermissionsChanged"
  | "exportNotesChanged"
  | "exportColorsChanged"
  | "exportOfflinePdfMissing"
  | "exportNotesUnready";

export class ExportError extends Error {
  constructor(readonly messageId: ExportErrorMessage) {
    super(getMessages(sourceLocale, "reader")(messageId));
  }
}
