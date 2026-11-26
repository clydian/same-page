import type { ApplicationIdentity } from "../auth/application-identity";
import type { DriveLibrarySnapshot } from "../score-library/drive-library";

export function sightSingingAccess(
  access: DriveLibrarySnapshot["access"] | undefined,
  authority: DriveLibrarySnapshot["reading"]["authority"] | undefined,
  identity: Pick<ApplicationIdentity, "authenticatedSessionId" | "onlineState">,
) {
  const member = Boolean(identity.authenticatedSessionId) && access?.kind === "opened"
    && access.isMember && !access.local && !access.choir.isPreviewEntry;
  const signedOut = identity.onlineState === "signed-out" || authority === "signed-out";
  const driveDenied = authority === "revoked"
    || access?.kind === "denied" || access?.kind === "not-found" || access?.kind === "join-required"
    || access?.kind === "opened" && (access.retained === true || !access.local && (!access.isMember || access.choir.isPreviewEntry === true));
  return { member, signedOut, driveDenied };
}
