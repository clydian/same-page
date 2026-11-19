import { useAppLocale, useMessages } from "../../i18n";
import { useSettingsIdentity } from "../auth/application-identity";
import { ViewSelector } from "../components/view-selector";
import { useReadResource } from "../settings/use-read-resource";
import { driveManagementSchema } from "../../shared/drive-management";
import { useSettingsMutation } from "../settings/settings-mutation";
import { captureLocalWorkspaceSession, resolveLocalWorkspace, type LocalWorkspace } from "../platform/local-workspace";
import { applySharedLayerAvailability } from "../annotations/annotation-state";
import { Button, Heading, Modal, ModalOverlay } from "react-aria-components";
import { Dialog } from "../navigation/overlays";
import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { sharedLayerAvailabilitySchema, sharedLayerManagementResponseSchema, type SharedLayerManagementSummary } from "../../shared/annotations";
import { diagnosticFetch } from "../diagnostics/diagnostics";
import { DriveSettingsContent } from "../score-library/drive-settings-content";
import { SettingsFeedback } from "../settings/settings-feedback";
import { settingsResponse } from "../settings/settings-request";
import { settingsError } from "../settings/settings-error";

export default function SharedLayerManagementPage() {
  const { choirId = "" } = useParams();
  const { userId, ready } = useSettingsIdentity();
  return <SharedLayerAccess key={`${userId ?? "guest"}:${choirId}`} choirId={choirId} userId={userId} ready={ready} />;
}

function SharedLayerAccess({ choirId, userId, ready }: { choirId: string; userId: string | null; ready: boolean }) {
  const t = useMessages("library");
  const resource = useReadResource({ owner: userId, driveId: choirId, kind: "layer-access" }, async signal =>
    driveManagementSchema.parse(await settingsResponse(await diagnosticFetch(`/api/choirs/${choirId}/management`, { signal }))), undefined, 0, ready);
  const overview = resource.data;
  const error = resource.error ? settingsError(resource.error, t("sharedLayerManagementFailedUpdateSharedLayer")) : null;
  if (overview?.capabilities.operations.operations.includes("configureLayers")) return <SharedLayerManagement choirId={choirId} userId={userId} authorized={resource.canMutate} accessError={error} retryAccess={resource.refresh} />;
  return <DriveSettingsContent choirId={choirId} name={overview?.name} section="shared-layers">
    <p>{t("sharedLayerManagementSharedNoteLayerAll")}</p>
    {overview ? <><ul className="shared-layer-summary">{overview.layers.map(layer => <li key={layer.slot}><strong>{layer.name}</strong><span>{layer.active ? t("sharedLayerManagementEnable") : t("sharedLayerManagementDisable")}</span></li>)}</ul><p>{t("sharedLayerManagementWhenAdjustmentsNeededFind")}</p><Link to={`/choirs/${choirId}/memberships`}>{t("sharedLayerManagementViewMembersPermissions")}</Link></> : <SettingsFeedback loading={!error} loadError={error} message={null} retry={() => void resource.refresh().catch(() => undefined)} />}
  </DriveSettingsContent>;
}

function SharedLayerManagement({ choirId, userId, authorized, accessError, retryAccess }: { choirId: string; userId: string | null; authorized: boolean; accessError: string | null; retryAccess: () => Promise<void> }) {
  const { locale } = useAppLocale();
  const t = useMessages("library");
  const workspaceRef = useRef<LocalWorkspace | null>(null);
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const [view, setView] = useState<"current" | "deleted">("current");
  const [deleting, setDeleting] = useState<SharedLayerManagementSummary | null>(null);
  const [newName, setNewName] = useState("");
  const resource = useReadResource({ owner: userId, driveId: choirId, kind: "shared-layers", variant: view }, async signal => {
    if (!userId) throw new Error("authentication_required");
    const workspace = await captureLocalWorkspaceSession(await resolveLocalWorkspace({ choirId, scoreId: "shared-layer-management", authenticatedUserId: userId, signal }));
    signal.throwIfAborted(); workspaceRef.current = workspace;
    const body = sharedLayerManagementResponseSchema.parse(await settingsResponse(await diagnosticFetch(`/api/choirs/${choirId}/shared-layers?state=${view}`, { signal })));
    signal.throwIfAborted();
    if (!await applySharedLayerAvailability(workspace, body)) throw new Error("shared_layer_state_changed");
    return body;
  });
  const layers = resource.data?.layers ?? [];
  const driveName = resource.data?.drive.name ?? "";
  const mutation = useSettingsMutation({
    enabled: authorized && resource.canMutate,
    refresh: async () => { await Promise.all([retryAccess(), resource.refresh()]); },
    onRevoked: resource.clear,
  });
  const { pending, message: feedback } = mutation;
  const loading = mutation.blocked;
  const loadError = accessError ?? (resource.error ? settingsError(resource.error, t("sharedLayerManagementSharedLayerCannotUpdated")) : null);
  const retryLoad = () => { void mutation.refresh().catch(() => undefined); };

  const change = async (path: string, method: "POST" | "PUT", body: object) => {
    const workspace = workspaceRef.current;
    const result = await mutation.submit(
      () => diagnosticFetch(`/api/choirs/${choirId}/shared-layers${path}`, {
        method, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      }),
      { confirmed: async (response, isCurrent) => {
        if (method === "POST") setNewName("");
        if (path.endsWith("/lifecycle")) {
          const state = sharedLayerAvailabilitySchema.parse(await response.json());
          if (!isCurrent()) return;
          if (!workspace || !await applySharedLayerAvailability(workspace, state)) throw new Error("shared_layer_state_changed");
        }
      } },
    );
    if (result !== null) setDeleting(null);
  };

  return <DriveSettingsContent choirId={choirId} name={driveName} section="shared-layers">
      <header className="settings-heading">
        <p className="settings-copy">{t("sharedLayerManagementApplicableAllScoresCloud")}</p>
      </header>
      <SettingsFeedback loading={resource.loading} loadError={loadError} message={null} retry={retryLoad} />
      {feedback && <p role="alert">{feedback}</p>}
      {mutation.needsRefresh && <button className="secondary-button" disabled={pending} onClick={retryLoad}>{t("sharedLayerManagementRereadSharedLayer")}</button>}
      <ViewSelector<"current" | "deleted"> label={t("sharedLayerManagementSharedLayerView")} value={view} pending={pending} onChange={setView} options={[{ id: "current", label: t("sharedLayerManagementCurrentSharedLayer") }, { id: "deleted", label: t("sharedLayerManagementLayerDeleted") }]} />
      {view === "deleted" && <p className="settings-copy">{t("sharedLayerManagementDeletionAffectsAllScores")}</p>}
      {resource.data && <>
        <section className="settings-card" aria-label={t("sharedLayerManagementSharedLayerManagementList")} aria-busy={loading || pending}>
          {!loading && !layers.length && <p>{view === "deleted" ? t("sharedLayerManagementThereNoDeletedShared") : t("sharedLayerManagementThereNoSharedLayer")}</p>}
          {layers.map((layer, index) => <article className="settings-layer-row settings-layer-row--management" key={layer.slot}>
            {view === "deleted" ? <div className="settings-layer-link">
              <span className="settings-layer-swatch" style={{ background: layer.defaultColor }} />
              <strong>{layer.name}</strong>
              <small>{layer.recoverUntil !== null && layer.recoverUntil > now
                ? t(layer.active ? "sharedLayerRestoreActiveUntil" : "sharedLayerRestoreInactiveUntil", { deadline: new Date(layer.recoverUntil).toLocaleString(locale) })
                : t("sharedLayerManagementExpiredUnrecoverableWaitingPermanent")}</small>
              <button className="secondary-button" disabled={pending || loading || layer.recoverUntil === null || layer.recoverUntil <= now}
                onClick={() => void change(`/${layer.slot}/lifecycle`, "POST", { action: "restore", expectedRevision: layer.revision })}>{t("membershipManagementRecoveryMembership")}</button>
            </div> : <>
            <Link className="settings-layer-link" to={`/choirs/${choirId}/shared-layers/${layer.slot}`}>
              <span className="settings-layer-swatch" style={{ background: layer.defaultColor }} />
              <strong>{layer.name}</strong>
              <small>{layer.active ? t("sharedLayerManagementAuthorizedMembers", { grantedMemberCount: String(layer.grantedMemberCount) }) : t("sharedLayerManagementDisabledNoteRetention")}</small><span aria-hidden="true">›</span>
            </Link>
            <div className="layer-order-actions">
              <button aria-label={t("sharedLayerManagementMoveUp", { name: String(layer.name) })} disabled={pending || loading || index === 0} onClick={() => void change(`/${layer.slot}/order`, "PUT", { direction: "up" }) }><ArrowUp size={18} aria-hidden="true" /></button>
              <button aria-label={t("sharedLayerManagementMoveDown", { name: String(layer.name) })} disabled={pending || loading || index === layers.length - 1} onClick={() => void change(`/${layer.slot}/order`, "PUT", { direction: "down" }) }><ArrowDown size={18} aria-hidden="true" /></button>
              <button className="text-button" disabled={pending || loading} onClick={() => setDeleting(layer)} aria-label={t("sharedLayerManagementDelete", { name: String(layer.name) })}>{t("sharedLayerManagementDelete2")}</button>
            </div>
            </>}
          </article>)}
        </section>
        {view === "current" && <form className="layer-create-form" onSubmit={event => { event.preventDefault(); if (newName.trim()) void change("", "POST", { name: newName.trim(), defaultColor: "#3157a4" }); }}>
          <label>{t("sharedLayerManagementNewSharedLayerName")}<input type="text" value={newName} maxLength={60} required disabled={pending || loading} onChange={event => setNewName(event.target.value)} /></label>
          <button className="secondary-button" disabled={pending || loading}>{t("sharedLayerManagementAddedNewSharingLayer")}</button>
        </form>}
      </>}
    <ModalOverlay className="modal-overlay" isOpen={deleting !== null} isDismissable={!pending} onOpenChange={open => { if (!open && !pending) setDeleting(null); }}>
      <Modal className="app-modal app-modal--compact"><Dialog className="app-dialog" exitDisabled={pending}>
        <Heading slot="title">{t("confirmDeleteSharedLayer", { name: deleting?.name ?? "" })}</Heading>
        <p>{t("sharedLayerManagementDeleteSharedLayerAll")}</p>
        <p>{t("sharedLayerManagementOriginalLayerNotesAuthorization")}</p>
        <p>{t("sharedLayerManagementDisconnectedDeviceStopUploading")}</p>
        <div className="dialog-actions">
          <Button className="secondary-button" isDisabled={pending} onPress={() => setDeleting(null)}>{t("cancel")}</Button>
          <Button className="primary-button" isDisabled={pending} onPress={() => {
            if (deleting) void change(`/${deleting.slot}/lifecycle`, "POST", { action: "delete", expectedRevision: deleting.revision });
          }}>{pending ? t("sharedLayerManagementDeleting") : t("sharedLayerManagementDeleteEntireSharedLayer")}</Button>
        </div>
      </Dialog></Modal>
    </ModalOverlay>
  </DriveSettingsContent>;
}
