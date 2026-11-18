import { useMessages } from "../../i18n";
import { useUnsavedChanges } from "./use-unsaved-changes";
import { useState } from "react";
import type { SharedLayerManagementSummary } from "../../shared/annotations";
import { diagnosticFetch } from "../diagnostics/diagnostics";
import { useSettingsMutation } from "./settings-mutation";

export function SharedLayerDetailsForm({ choirId, layer, onSaved, authorized, refresh, onRevoked }: {
  choirId: string; layer: SharedLayerManagementSummary; onSaved(layer: SharedLayerManagementSummary): void;
  authorized: boolean; refresh(): Promise<void>; onRevoked(): void;
}) {
  const t = useMessages("library");
  const [name, setName] = useState(layer.name);
  const [color, setColor] = useState(layer.defaultColor);
  const [active, setActive] = useState(layer.active);
  const [baseline, setBaseline] = useState(layer);
  if (baseline !== layer) {
    setBaseline(layer);
    // A warm read updates a pristine form; a conflict read preserves edits.
    if (name === baseline.name && color === baseline.defaultColor && active === baseline.active) {
      setName(layer.name); setColor(layer.defaultColor); setActive(layer.active);
    }
  }
  const mutation = useSettingsMutation({ enabled: authorized, refresh, onRevoked });
  const { pending, message: feedback, blocked } = mutation;
  const dirty = name.trim() !== layer.name || color !== layer.defaultColor || active !== layer.active;
  const discard = () => { setName(layer.name); setColor(layer.defaultColor); setActive(layer.active); };
  const save = async () => {
    if (!name.trim()) return false;
    const changes = { name: name.trim(), defaultColor: color, active };
    return await mutation.submit(() => diagnosticFetch(`/api/choirs/${choirId}/shared-layers/${layer.slot}/settings`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(changes),
    }), { confirmed: () => onSaved({ ...layer, ...changes }) }) === true;
  };
  const exitDialog = useUnsavedChanges({ subject: t("sharedLayerDetailsFormSharedLayerConfiguration"), dirty, save, discard, saveState: mutation });
  return <form className="settings-card layer-details-form" aria-label={t("sharedLayerDetailsFormSharedLayerSettings")} onSubmit={event => { event.preventDefault(); void save(); }}>
    {exitDialog}{dirty && <p role="status">{t("membershipManagementNotSaved")}</p>}
    <p className="settings-copy">{t("sharedLayerDetailsFormDefaultAllMembersCloud")}</p>
    <label>{t("attachmentName")}<input type="text" value={name} required maxLength={60} disabled={blocked} onChange={event => setName(event.target.value)} /></label>
    <label className="settings-color-control">{t("sharedLayerDetailsFormCloudDiskDefaultColor")}<input type="color" value={color} disabled={blocked} onChange={event => setColor(event.target.value)} /></label>
    <label className="layer-active-toggle"><input type="checkbox" checked={active} disabled={blocked} onChange={event => setActive(event.target.checked)} />{t("sharedLayerDetailsFormEnableSharedLayer")}</label>
    <p className="settings-copy">{t("sharedLayerDetailsFormHideNotesPauseEditing")}</p>
    <button className="primary-button" disabled={blocked || !dirty || !name.trim()}>{pending ? t("saving") : t("sharedLayerDetailsFormSaveSettings")}</button>
    {dirty && <button type="button" className="secondary-button" disabled={blocked} onClick={discard}>{t("membershipManagementCancelModification")}</button>}
    {feedback && <p role="alert">{feedback}</p>}
    {mutation.needsRefresh && <button type="button" className="secondary-button" disabled={pending} onClick={() => void mutation.refresh().catch(() => undefined)}>{t("sharedLayerManagementRereadSharedLayer")}</button>}
  </form>;
}
