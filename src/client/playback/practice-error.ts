import { getMessages, sourceLocale } from "../../i18n";

export type PracticeOpeningErrorCode =
  | "attachmentTimeout"
  | "localVerificationInterrupted"
  | "attachmentUpdated"
  | "offlineNotReady"
  | "attachmentRevisionMissing"
  | "readFailure";

export class PracticeOpeningError extends Error {
  constructor(readonly code: PracticeOpeningErrorCode, options?: ErrorOptions) {
    super(getMessages(sourceLocale, "practice")(code), options);
    this.name = "PracticeOpeningError";
  }
}
