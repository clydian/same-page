import { useAppLocale, useMessages } from "../../i18n";
import { SettingsFeedback } from "../settings/settings-feedback";
import { authenticatedLocalOwnerKey, currentLocalOwnerKey } from "../platform/local-workspace";
import { useUserLifecycle } from "../settings/use-user-lifecycle";
import { useState } from "react";
import { Button } from "react-aria-components";
import { Link, useNavigate } from "react-router-dom";
import { authClient } from "../auth/auth-client";
import { TaskHeader } from "../components/task-header";
import { ACTIVE_LOCAL_OWNER_KEY, LAST_AUTHENTICATED_OWNER_KEY, localDatabase } from "../platform/local-database";
import { notifyReaderIdentityChange } from "../reader/reader-cache-events";

export default function UserLifecyclePage() {
  const session = authClient.useSession();
  return <UserLifecycle key={session.data?.user.id ?? "recovery"} />;
}
function UserLifecycle() {
  const { locale } = useAppLocale();
  const t = useMessages("library");
  const session = authClient.useSession();
  const navigate = useNavigate();
  const { state, setState, message, setMessage, busy, loading, blocked, reload, perform } = useUserLifecycle();
  const [acceptedUser, setAcceptedUser] = useState<string | null>(null);
  const finishDeletion = async (isCurrent: () => boolean) => {
    // Disconnect identity pointers only; drafts remain keyed to their original user.
    await localDatabase.transaction("rw", localDatabase.system, async () => {
      if (!isCurrent() || !state || await currentLocalOwnerKey() !== authenticatedLocalOwnerKey(state.userId)) return;
      await localDatabase.system.bulkDelete([ACTIVE_LOCAL_OWNER_KEY, LAST_AUTHENTICATED_OWNER_KEY]);
    });
    if (!isCurrent()) return;
    notifyReaderIdentityChange();
    await authClient.getSession();
    if (!isCurrent()) return;
    setState(null); setMessage(t("userLifecycleUserHasBeenDeactivated"));
  };
  const ownedDrives = state?.memberships.filter((member) => member.isOwner === 1) ?? [];
  if (state && !state.deletion && (session.isPending || session.data?.user.id !== state.userId)) return <p role="status">{t("userLifecycleVerifyingLoginIdentity")}</p>;
  return <div className="app-page"><TaskHeader title={state?.deletion ? t("userLifecycleRestoreUser") : t("userLifecycleDeleteUser")} backTo={"/user"} /><main className="page-shell settings-page settings-ux lifecycle-page">
    <header className="settings-heading"></header>
    {state ? state.deletion ? <section>
      <h2>{t("userLifecycleRestoreUser")}</h2>
      <p>{t("userRecoveryDeadline", { deadline: new Date(state.deletion.expiresAt).toLocaleString(locale) })}</p>
      <p>{t("loginForUserRecovery", { method: state.deletion.authMethod === "credential" ? t("userLifecycleEmailPassword") : "Google" })}</p>
      <Link className="secondary-link" to="/login">{t("userLifecycleReVerifyOriginalLogin")}</Link>
      <Button className="secondary-button" isDisabled={blocked} onPress={() => void perform("/api/user/lifecycle/restore", { confirm: true, deletionId: state.deletion!.deletionId }, async isCurrent => { await authClient.getSession(); if (isCurrent()) await navigate("/login"); })}>{t("userLifecycleConfirmUserRecovery")}</Button>
    </section> : <>
      <section>
        <p>{t("userLifecycleDeletionImmediatelyRevokeAll")}</p>
        <p>{t("userLifecycleDownloadedContentCannotRetrieved")}</p>
        {ownedDrives.length ? <p role="alert">{t("transferOwnedDrivesFirst", { names: new Intl.ListFormat(locale).format(ownedDrives.map(member => member.name)) })}</p> : null}
        {!state.reauthenticated ? <Button className="secondary-button" isDisabled={blocked || ownedDrives.length > 0} onPress={() => void perform("/api/user/lifecycle/reauthenticate", { expectedUserId: state.userId }, async () => { await navigate("/login"); })}>{t("userLifecycleReVerifyOriginalLogin")}</Button> : <>
          <label className="confirmation-checkbox"><input type="checkbox" checked={acceptedUser === state.userId} onChange={(event) => setAcceptedUser(event.target.checked ? state.userId : null)} /><span>{t("userLifecycleUnderstandImpactDeletionThirty")}</span></label>
          <Button className="primary-button" isDisabled={blocked || acceptedUser !== state.userId || ownedDrives.length > 0} onPress={() => void perform("/api/user/lifecycle/delete", { confirm: true, expectedUserId: state.userId }, finishDeletion)}>{t("userLifecycleConfirmUserDeletion")}</Button>
        </>}
      </section>
    </> : !loading && <Link className="secondary-link" to="/login">{t("userLifecycleLogRestoreUser")}</Link>}
    <SettingsFeedback loading={loading} loadError={null} message={message} retry={() => void reload().catch(() => undefined)} />
    {message && <Button className="secondary-button" isDisabled={busy || loading} onPress={() => void reload().catch(() => undefined)}>{t("leaveDriveRereadStatus")}</Button>}
  </main></div>;
}
