import { PersonalMenu, type PersonalDriveActions } from "../components/personal-menu";
import { NAVIGATION_FRESH_MS } from "../settings/navigation-events";
import { driveSettingsSchema } from "../../shared/choirs";
import { diagnosticFetch, parseDiagnosticResponse } from "../diagnostics/diagnostics";
import { SettingsRequestError } from "../settings/settings-request";
import { useReadResource } from "../settings/use-read-resource";

type Props = PersonalDriveActions & { userId: string; email?: string | null };

export function DrivePersonalMenu(props: Props) {
  const { userId, choirId } = props;
  const settings = useReadResource({ owner: userId, driveId: choirId, kind: "settings" }, async signal => {
    const response = await diagnosticFetch(`/api/choirs/${choirId}/settings`, { signal });
    if (!response.ok) throw new SettingsRequestError(response.status);
    return parseDiagnosticResponse(response, driveSettingsSchema);
  }, undefined, NAVIGATION_FRESH_MS, !props.localOnly);
  return <PersonalMenu email={props.email} drive={{ ...props, displayName: props.displayName ?? settings.data?.displayName }} />;
}
