import { useMessages } from "../../i18n";
import { notifyReaderIdentityChange } from "../reader/reader-cache-events";
import { rememberDriveAccessRevoked } from "../score-library/local-drive-directory";
import { authenticatedLocalOwnerKey, captureLocalWorkspaceSession, createLocalWorkspace } from "../platform/local-workspace";
import { SettingsFeedback } from "../settings/settings-feedback";
import { useState } from "react";
import { Button } from "react-aria-components";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useApplicationIdentity } from "../auth/application-identity";
import { DriveSettingsDialog } from "../score-library/drive-settings-dialog";
import { TaskHeader } from "../components/task-header";
import { ConfirmDialog, type Confirmation } from "../settings/confirm-dialog";
import { useUserLifecycle } from "../settings/use-user-lifecycle";

export default function LeaveDrivePage() {
  const { choirId = "" } = useParams();
  const identity = useApplicationIdentity();
  const [knownSession, setKnownSession] = useState(identity.authenticatedSessionId);
  if (identity.authenticatedSessionId && knownSession !== identity.authenticatedSessionId) setKnownSession(identity.authenticatedSessionId);
  const presentationSession = identity.onlineState === "signed-out" ? null : identity.authenticatedSessionId ?? knownSession;
  return <LeaveDrive key={`${identity.localUserId ?? "guest"}:${choirId}:${presentationSession}`} choirId={choirId} userId={identity.localUserId} />;
}
function LeaveDrive({ choirId, userId }: { choirId: string; userId: string | null }) {
  const t = useMessages("library");
  const navigate = useNavigate();
  const { state, message, busy, loading, blocked, reload, perform } = useUserLifecycle();
  const member = state?.memberships.find(member => member.choirId === choirId);
  const [editingName, setEditingName] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  return <div className="app-page">
    <TaskHeader title={t("leaveDriveIdentityCloudDisk")} backTo={`/choirs/${choirId}`} />
    <main className="page-shell settings-page settings-ux lifecycle-page drive-identity-page">
      <header className="settings-heading"><p>{member?.name}</p><p className="settings-copy">{t("leaveDriveManageNameMembershipCloud")}</p></header>
      {member && <section className="membership-identity" aria-labelledby="membership-identity-heading">
        <h2 id="membership-identity-heading">{t("leaveDriveAmCloudDisk")}</h2>
        <dl><div><dt>{t("displayName")}</dt><dd>{member.displayName}</dd></div><div><dt>{t("leaveDriveMembership")}</dt><dd>{member.status === "removed" ? t("leaveDriveExitedRemoved") : member.isOwner === 1 ? t("owner") : t("member")}</dd></div></dl>
        {member.status === "active" && userId && <Button className="secondary-button" isDisabled={blocked} onPress={() => setEditingName(true)}>{t("leaveDriveModifyDisplayName")}</Button>}
      </section>}
      {state && <section className="membership-exit"><h2>{t("leaveDriveExitCloudDisk")}</h2>
        {state.memberships.filter(member => member.choirId === choirId).map((member) => <article className="lifecycle-member" key={member.id}>
          <p className="settings-copy">{member.status === "removed" ? t("leaveDriveExitedRemoved") : member.isOwner === 1 ? t("leaveDriveOwnerCloudDisk") : t("leaveDriveExitingEndMembershipRelationship")}</p>
          {member.isOwner === 1 && member.status === "active" ? <><p>{t("leaveDriveOwnersMustTransferOwnership")}</p><Link className="secondary-link" to={`/choirs/${member.choirId}/memberships`}>{t("leaveDriveManagingMembersHandover")}</Link></> : null}
          {member.status === "active" ? <Button className="secondary-button destructive-link" isDisabled={blocked || member.isOwner === 1} onPress={() => setConfirmation({ title: t("leaveDriveExitMembership", { name: String(member.name) }), action: t("leaveDriveConfirmMembershipWithdrawal"), destructive: true, message: <div className="exit-consequences"><section><h3>{t("leaveDriveWhatLose")}</h3><p>{member.isPreviewEntry ? t("leaveDriveMemberOperationRightsShared") : t("leaveDriveImmediatelyStopCloudAccess")}</p></section><section><h3>{t("leaveDriveContentStillThere")}</h3><p>{member.isPreviewEntry ? t("leaveDriveMyNotesStillAvailable") : t("leaveDriveCloudPersonalTierRetained")}{t("leaveDriveSharedNotesLocalDownloads")}</p></section><section><h3>{t("leaveDriveHowRestore")}</h3><p>{t("leaveDriveContactCloudDiskOwner")}</p></section></div>, onConfirm: () => perform(`/api/choirs/${member.choirId}/memberships/${member.id}`, { action: "remove", expectedRevision: member.revision }, async () => {
            notifyReaderIdentityChange();
            if (userId && !member.isPreviewEntry) {
              const workspace = await captureLocalWorkspaceSession(createLocalWorkspace(authenticatedLocalOwnerKey(userId), choirId, ""));
              await rememberDriveAccessRevoked(workspace, new AbortController().signal);
            }
            await navigate("/drives");
          }) })}>{t("leaveDriveExitCloudDisk")}</Button> : <p>{t("leaveDriveContactCloudDiskOwner2")}</p>}
        </article>)}
      </section>}

      {state && !state.memberships.some(member => member.choirId === choirId) && <p>{t("leaveDriveNoMembershipCloudDisk")}</p>}
      <SettingsFeedback loading={loading} loadError={null} message={message} retry={() => void reload().catch(() => undefined)} />
      {message && <Button isDisabled={busy || loading} onPress={() => void reload().catch(() => undefined)}>{t("leaveDriveRereadStatus")}</Button>}
      {editingName && userId && <DriveSettingsDialog choirId={choirId} userId={userId} field="display-name" onClose={() => setEditingName(false)} onSaved={async () => { await reload().catch(() => undefined); }} />}
      <ConfirmDialog confirmation={confirmation} busy={busy} onClose={() => setConfirmation(null)} />
    </main>
  </div>;
}
