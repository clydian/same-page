import { useMessages } from "../../i18n";
import { useSettingsIdentity } from "../auth/application-identity";
import { SharedLayerDetailsForm } from "../settings/shared-layer-details-form";
import { diagnosticFetch } from "../diagnostics/diagnostics";
import { useReadResource } from "../settings/use-read-resource";
import { useParams } from "react-router-dom";

import {
  sharedLayerSlotSchema,
  sharedLayerManagementResponseSchema,
  type SharedLayerManagementSummary,
} from "../../shared/annotations";
import { TaskHeader } from "../components/task-header";
import { SettingsFeedback } from "../settings/settings-feedback";
import { settingsResponse } from "../settings/settings-request";
import { settingsError } from "../settings/settings-error";

export default function SharedLayerDetailsPage() {
  const { choirId = "", slot: slotParam = "" } = useParams();
  const { userId, ready } = useSettingsIdentity();
  return <SharedLayerDetails key={`${userId ?? "guest"}:${choirId}:${slotParam}`} choirId={choirId} slotParam={slotParam} userId={userId} ready={ready} />;
}

function SharedLayerDetails({ choirId, slotParam, userId, ready }: { choirId: string; slotParam: string; userId: string | null; ready: boolean }) {
  const t = useMessages("library");
  const parsedSlot = sharedLayerSlotSchema.safeParse(slotParam);
  const slot = parsedSlot.success ? parsedSlot.data : null;
  const resource = useReadResource({ owner: userId, driveId: choirId, kind: "shared-layer", variant: slotParam }, async signal => {
    if (!slot) throw new Error("invalid_shared_layer");
    return sharedLayerManagementResponseSchema.parse(await settingsResponse(await diagnosticFetch(`/api/choirs/${choirId}/shared-layers`, { signal })));
  }, undefined, 0, ready);
  const driveName = resource.data?.drive.name ?? "";
  const layer = resource.data?.layers.find(entry => entry.slot === slot) ?? null;
  const loadError = resource.error ? settingsError(resource.error, t("sharedLayerDetailsTemporarilyUnableReadEdit")) : null;
  const setLayer = (next: SharedLayerManagementSummary) => {
    if (resource.data) resource.confirm({ ...resource.data, layers: resource.data.layers.map(entry => entry.slot === next.slot ? next : entry) });
  };

  const layerName = layer ? layer.name : slot ?? t("sharedLayers");


  return (
    <div className="app-page">
      <TaskHeader title={layerName} backTo={`/choirs/${choirId}/shared-layers`} />
      <main className="page-shell settings-page settings-ux">
        <header className="settings-heading">
          <p className="eyebrow">{t("sharedLayerSettingsBreadcrumb", { name: driveName || t("sharedLayers") })}</p>

          <p className="settings-copy">{t("sharedLayerDetailsConfigurationTakesEffectAll")}</p>
        </header>
        {slot ? <SettingsFeedback loading={resource.loading} loadError={loadError} message={null} retry={() => void resource.refresh().catch(() => undefined)} /> : <p role="alert">{t("sharedLayerDetailsSharedLayerDoesNot")}</p>}
        {layer && <SharedLayerDetailsForm choirId={choirId} layer={layer} onSaved={setLayer} authorized={resource.canMutate} refresh={resource.refresh} onRevoked={resource.clear} />}
      </main>
    </div>
  );
}
