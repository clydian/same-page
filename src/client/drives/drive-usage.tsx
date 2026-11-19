import { useMessages } from "../../i18n";
import { SettingsRequestError } from "../settings/settings-request";
import { NAVIGATION_FRESH_MS } from "../settings/navigation-events";
import { z } from "zod";
import { Button } from "react-aria-components";
import { useReadResource } from "../settings/use-read-resource";
import { diagnosticFetch, parseDiagnosticResponse } from "../diagnostics/diagnostics";
import { formatBytes } from "../score-library/library-format";
const schema = z.object({ plan: z.enum(["free", "configured"]), usedBytes: z.number(), limitBytes: z.number(),
  scoreCount: z.number(), scoreLimit: z.number().nullable(), memberCount: z.number(), memberLimit: z.number().nullable() });
export function DriveUsage({ choirId, userId }: { choirId: string; userId: string }) {
  const t = useMessages("entry");
  const resource = useReadResource({ owner: userId, driveId: choirId, kind: "usage" }, async signal => {
    const response = await diagnosticFetch(`/api/choirs/${choirId}/usage`, { signal });
    if (!response.ok) throw new SettingsRequestError(response.status);
    return parseDiagnosticResponse(response, schema);
  }, undefined, NAVIGATION_FRESH_MS);
  const data = resource.data;
  return <section className="management-row"><h2>{data?.plan === "free" ? t("usage.trial") : t("usage.title")}</h2>
    {data ? <><p>{t("usage.details", { scores: data.scoreLimit === null ? String(data.scoreCount) : `${data.scoreCount}/${data.scoreLimit}`, used: formatBytes(data.usedBytes), limit: formatBytes(data.limitBytes), members: data.memberLimit === null ? String(data.memberCount) : `${data.memberCount}/${data.memberLimit}` })}</p>
      <p>{t("usage.trash")}</p></> : <p role="status">{resource.error ? t("usage.error") : t("usage.working")}</p>}
    <Button className="secondary-button" onPress={() => void resource.refresh().catch(() => undefined)}>{t("usage.refresh")}</Button>
  </section>;
}
