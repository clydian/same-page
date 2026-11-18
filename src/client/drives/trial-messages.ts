import { getCurrentLocale, getMessages } from "../../i18n";
export function trialMessage(code?: string) {
  const t = getMessages(getCurrentLocale(), "entry");
  switch (code) {
    case "platform_storage_limit_reached": return t("trial.platformFull");
    case "free_drive_limit_reached": return t("trial.driveLimit");
    case "owned_drive_limit_reached": return t("trial.ownedLimit");
    case "identity_verification_required": return t("trial.verifyIdentity");
    case "member_limit_reached": return t("trial.memberLimit");
    case "score_limit_reached": return t("trial.scoreLimit");
    case "try_again_later": return t("trial.retryLater");
    case "confirmation_mismatch": return t("trial.confirmationMismatch");
    case "forbidden": case "identity_changed": return t("trial.accessChanged");
    case "resource_deleted": return t("trial.deleted");
    default: return t("trial.generalError");
  }
}
