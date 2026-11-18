import { useMessages } from "../../i18n";
import { useParams, useSearchParams, Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { useApplicationIdentity } from "../auth/application-identity";
import { loginHref } from "../auth/login-return";
import { TaskHeader } from "../components/task-header";
import { settingsError } from "../settings/settings-request";
import { SettingsFeedback } from "../settings/settings-feedback";
import { authenticatedLocalOwnerKey, captureLocalWorkspaceSession, createLocalWorkspace, type LocalWorkspace } from "../platform/local-workspace";
import { useDriveReadingPreferences } from "../reader/use-reading-preferences";

export default function DriveLayerPreferencesPage() {
  const { choirId = "" } = useParams();
  const identity = useApplicationIdentity();
  return <DrivePreferenceEntry key={`${identity.localUserId}:${choirId}`} choirId={choirId} userId={identity.localUserId} signedIn={!!identity.authenticatedUserId} restoring={identity.restoring || identity.onlineState === "checking"} />;
}
function DrivePreferenceEntry({ choirId, userId, signedIn, restoring }: { choirId: string; userId: string | null; signedIn: boolean; restoring: boolean }) {
  const t = useMessages("library");
  const [workspace, setWorkspace] = useState<LocalWorkspace | null>(null);
  useEffect(() => {
    let active = true;
    if (userId) void captureLocalWorkspaceSession(createLocalWorkspace(authenticatedLocalOwnerKey(userId), choirId, ""))
      .then(value => { if (active) setWorkspace(value); }).catch(() => undefined);
    return () => { active = false; };
  }, [choirId, userId]);
  if (workspace) return <DriveLayerPreferences workspace={workspace} signedIn={signedIn} />;
  return <div className="app-page"><TaskHeader title={t("readingPreferences")} backTo={`/choirs/${choirId}`} /><main className="page-shell settings-page"><p>{userId || restoring ? t("driveLayerPreferencesRestoringReadingPreferences") : t("driveLayerPreferencesSetDefaultDisplayCloud")}</p>{!userId && !restoring && <Link to={loginHref(`/choirs/${choirId}/preferences`)}>{t("driveLayerPreferencesSetDefaultDisplayAfter")}</Link>}</main></div>;
}
function DriveLayerPreferences({ workspace, signedIn }: { workspace: LocalWorkspace; signedIn: boolean }) {
  const t = useMessages("library");
  const { choirId } = workspace;
  const [params] = useSearchParams();
  const colors = params.get("view") === "colors";
  const resource = useDriveReadingPreferences(workspace, signedIn);
  const { layers, save, feedback: preferenceFeedback } = resource;
  return <div className="app-page"><TaskHeader title={colors ? t("driveLayerPreferencesNoteColor") : t("readingPreferences")} backTo={colors ? `/choirs/${choirId}/preferences` : `/choirs/${choirId}`} />
    <main className="page-shell settings-page settings-ux reading-preferences">
      <header className="settings-heading"><p>{resource.drive?.name}</p><p className="settings-copy">{t("driveLayerPreferencesMusicScoresAppliedCloud")}</p></header>
      <p className="settings-copy">{t("driveLayerPreferencesChangeAutoSave")}</p>
      <SettingsFeedback loading={resource.loading} loadError={resource.error ? settingsError(resource.error, t("updateFailedExistingKept")) : null} message={null} retry={() => void resource.refresh().catch(() => undefined)} />
      {resource.authority === "signed-out" && <Link to={loginHref(`/choirs/${choirId}/preferences`)}>{t("driveLayerPreferencesLogAgain")}</Link>}
      {resource.drive && <section className="settings-card" aria-label={colors ? t("driveLayerPreferencesNoteColor") : t("driveLayerPreferencesNotesDisplayedDefault")}>
        {!colors && <h2 className="settings-group-title">{t("driveLayerPreferencesNotesDisplayedDefault")}</h2>}
        {layers.map(layer => {
          const target = { kind: "drive" as const, id: layer.slot };
          const feedback = preferenceFeedback(target);
          return <article className="preference-row" key={layer.slot}>
            {colors ? <><div className="preference-color-heading"><strong>{layer.name}</strong><label className="settings-color-control"><span>{layer.colorOverride ? t("driveLayerPreferencesCustomization") : t("driveLayerPreferencesCloudDiskDefault")}</span>
              <input aria-label={t("driveLayerPreferencesNoteColor2", { name: String(layer.name) })} type="color" value={layer.displayColor} onChange={event => void save(target, { colorOverride: event.target.value })} /></label></div>
              <div className="preference-color-preview" style={{ color: layer.displayColor }} aria-label={t("driveLayerPreferencesNotePreview", { name: String(layer.name) })}><svg aria-hidden="true" viewBox="0 0 120 24"><path d="M4 16 Q30 2 58 14 T116 8" /></svg><span>{t("driveLayerPreferencesFadePayAttentionBreathing")}</span></div>
              {layer.colorOverride && <button className="text-button" aria-label={t("driveLayerPreferencesRestoreDefaultColor", { name: String(layer.name) })} onClick={() => void save(target, { colorOverride: null })}>{t("driveLayerPreferencesRestoreDefaultColor2")}</button>}</>
              : <label className="preference-display-toggle"><span className="settings-layer-swatch" aria-hidden="true" style={{ background: layer.displayColor }} /><strong>{layer.name}</strong>
                <input aria-label={t("driveLayerPreferencesDisplayedDefault", { name: String(layer.name) })} type="checkbox" checked={layer.subscribed} onChange={event => void save(target, { subscribed: event.target.checked })} /></label>}
            {feedback && <div className="settings-row-feedback"><span role="status">{feedback.message}</span>{feedback.retry && <button className="text-button" aria-label={t("driveLayerPreferencesTryAgain", { name: String(layer.name) })} onClick={feedback.retry}>{t("retry")}</button>}</div>}
          </article>;
        })}
      </section>}
      {!colors && resource.drive && <Link className="settings-secondary-link" to="?view=colors"><span>{t("driveLayerPreferencesNoteColor")}</span><span aria-hidden="true">›</span></Link>}
    </main>
  </div>;
}
