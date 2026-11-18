import { getCurrentLocale, getMessages } from "../../i18n";
import { trialMessage } from "../drives/trial-messages";
export function lifecycleError(error?: string) {
  const t = getMessages(getCurrentLocale(), "entry");
  if (error === "member_limit_reached" || error === "owned_drive_limit_reached") return trialMessage(error);
  if (error === "identity_changed") return t("lifecycle.identityChanged");
  if (error === "owner_requires_transfer") return t("lifecycle.transferRequired");
  if (error === "reauthentication_required") return t("lifecycle.reauthenticate");
  if (error === "recovery_unavailable") return t("lifecycle.cannotRecover");
  if (error === "membership_conflict") return t("lifecycle.memberConflict");
  return t("lifecycle.generalError");
}
