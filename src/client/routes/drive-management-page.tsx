import { useAppLocale, useMessages } from "../../i18n";
import { useSettingsIdentity } from "../auth/application-identity";
import { NAVIGATION_FRESH_MS } from "../settings/navigation-events";
import { notifyReaderIdentityChange } from "../reader/reader-cache-events";
import { rememberDriveAccessRevoked, renameLocalDriveDirectory } from "../score-library/local-drive-directory";
import { authenticatedLocalOwnerKey, captureLocalWorkspaceSession, createLocalWorkspace } from "../platform/local-workspace";
import { PurgeDialog } from "../drives/purge-dialog";
import { DriveUsage } from "../drives/drive-usage";
import { useReadResource } from "../settings/use-read-resource";
import { driveCacheOwnerKey, invalidateDriveLibrary } from "../score-library/drive-library-cache";
import { useState } from "react";
import { Button } from "react-aria-components";
import { Link, useNavigate, useParams } from "react-router-dom";
import { LockKeyhole } from "lucide-react";
import { DriveSettingsContent } from "../score-library/drive-settings-content";
import { driveManagementSchema } from "../../shared/drive-management";
import { managedMembershipsSchema } from "../../shared/lifecycle";
import type { Operation } from "../../shared/drive-permissions";
import { permissionMessageKeys } from "../settings/permission-messages";
import { diagnosticFetch, parseDiagnosticResponse } from "../diagnostics/diagnostics";
import { SettingsRequestError } from "../settings/settings-request";
import { settingsError } from "../settings/settings-error";
import { DriveSettingsDialog } from "../score-library/drive-settings-dialog";
import { InviteSharing } from "../score-library/invite-sharing";
import { TrashContents } from "../score-library/trash-contents";

type Overview = ReturnType<typeof driveManagementSchema.parse>;
type Members = ReturnType<typeof managedMembershipsSchema.parse>;
export default function DriveManagementPage({ section, index = false }: { section: "info" | "admission" | "trash"; index?: boolean }) {
  const { choirId = "" } = useParams();
  const { userId, ready } = useSettingsIdentity();
  return <DriveManagement key={`${userId ?? "guest"}:${choirId}`} choirId={choirId} userId={userId ?? "guest"} ready={ready} section={section} index={index} />;
}
function DriveManagement({ choirId, section, userId, ready, index }: { choirId: string; section: "info" | "admission" | "trash"; userId: string; ready: boolean; index: boolean }) {
  const t = useMessages("library");
  const navigate = useNavigate();
  const [purge, setPurge] = useState(false);
  const [dialog, setDialog] = useState<"name" | null>(null);
  const [locked, setLocked] = useState<Operation | null>(null);
  const resource = useReadResource<Overview>({ owner: userId, driveId: choirId, kind: "management" }, async signal => {
    const overviewResponse = await diagnosticFetch(`/api/choirs/${choirId}/management`, { signal });
    if (!overviewResponse.ok) throw new SettingsRequestError(overviewResponse.status);
    return parseDiagnosticResponse(overviewResponse, driveManagementSchema);
  }, undefined, NAVIGATION_FRESH_MS, ready);
  if (purge && !resource.canMutate) setPurge(false);
  const data = resource.data;
  const error = resource.error ? settingsError(resource.error, t("driveManagementCloudDiskSettingsUpdate")) : null;
  const refresh = () => { setDialog(null); setLocked(null); void resource.refresh().catch(() => undefined); };
  const can = (operation: Operation) => data?.capabilities.operations.operations.includes(operation);
  function row(title: string, value: string, label: string, operation: Operation, destination: (() => void) | string) {
    const allowed = can(operation);
    return <section className="management-row">
      <div className="management-row-main"><div><h2>{title}</h2><p>{value}</p></div>{allowed && typeof destination === "string" ? <Link className="secondary-button" to={destination}>{label}</Link> : <Button className="secondary-button" isDisabled={!resource.canMutate} aria-label={allowed ? label : t("driveManagementLockedAction", { action: label })} onPress={() => { if (allowed && resource.canMutate && typeof destination === "function") destination(); else setLocked(current => current === operation ? null : operation); }}>{!allowed && <LockKeyhole size={15} aria-hidden="true" />}{label}</Button>}</div>
      {locked === operation && <PermissionContacts userId={userId} choirId={choirId} operation={operation} isMember={Boolean(data?.isMember)} />}
    </section>;
  }
  return <DriveSettingsContent choirId={choirId} name={data?.name} section={section} index={index}>
    {!data && <p role={error ? "alert" : "status"}>{error ?? t("driveManagementReadingCloudDiskSettings")}</p>}
    {error && data && <p role="alert">{error}</p>}{error && <Button className="secondary-button" onPress={refresh}>{t("readAgain")}</Button>}
    {data && <>
      {!data.isMember && <p className="permission-lock-explanation">{t("driveManagementBrowsingCloudDiskRead")}</p>}
      <div className="management-list">
        {section === "info" && row(t("driveManagementCloudDiskName"), data.name, t("driveManagementModifyCloudDiskName"), "editDriveInfo", () => setDialog("name"))}
        {section === "admission" && (data.guestAdmissionMode === "invite" ? (can("manageInvites") ? <InviteSharing writable={resource.canMutate} choirId={choirId} choirName={data.name} /> : row(t("driveManagementVisitorEntryMethod"), t("driveManagementInvitationCodeRequired"), t("driveManagementViewPermissionDescription"), "manageInvites", () => {})) : <section className="management-row"><h2>{t("driveManagementVisitorEntryMethod")}</h2><p>{t("driveManagementOpenEntry")}</p></section>)}
        {section === "trash" && (can("trashFiles") ? <TrashContents writable={resource.canMutate} userId={userId} canPurge={data.capabilities.isOwner} choirId={choirId} onRestored={() => { invalidateDriveLibrary(driveCacheOwnerKey(userId, choirId), choirId); }} /> : row(t("trash"), t("driveManagementDeletedScoresRemainHere"), t("driveManagementViewPermissionDescription"), "trashFiles", () => {}))}
        {section === "info" && data.isMember && <DriveUsage choirId={choirId} userId={userId} />}
        {section === "info" && data.capabilities.isOwner && <section className="management-row"><h2>{t("driveManagementDeleteCloudDisk")}</h2><p>{t("driveManagementAllMembersLoseAccess")}</p><Button className="primary-button destructive-button" isDisabled={!resource.canMutate} onPress={() => setPurge(true)}>{t("driveManagementCompletelyDeleteCloudDisk")}</Button></section>}
      </div>
      {purge && resource.canMutate && data.capabilities.isOwner && <PurgeDialog userId={userId} path={`/api/choirs/${choirId}/purge`} title={t("driveManagementCompletelyDeleteCloudDisk")} driveName={data.name} description={t("driveManagementAllScoresAllMembers")} onClose={() => setPurge(false)} onComplete={async isCurrent => {
        const workspace = await captureLocalWorkspaceSession(createLocalWorkspace(authenticatedLocalOwnerKey(userId), choirId, ""));
        if (!isCurrent()) return;
        await rememberDriveAccessRevoked(workspace, new AbortController().signal);
        if (!isCurrent()) return;
        invalidateDriveLibrary(driveCacheOwnerKey(userId, choirId), choirId);
        notifyReaderIdentityChange();
        navigate("/drives", { replace: true });
      }} />}
      {dialog === "name" && can("editDriveInfo") && <NameSettings userId={userId} choirId={choirId} onClose={() => setDialog(null)} onSaved={refresh} />}
    </>}
  </DriveSettingsContent>;
}

function NameSettings({ choirId, userId, onClose, onSaved }: { choirId: string; userId: string; onClose: () => void; onSaved: () => void }) {
  return <DriveSettingsDialog choirId={choirId} userId={userId} field="name" onClose={onClose} onSaved={async name => {
    const workspace = await captureLocalWorkspaceSession(createLocalWorkspace(authenticatedLocalOwnerKey(userId), choirId, ""));
    await renameLocalDriveDirectory(workspace, name, new AbortController().signal);
    invalidateDriveLibrary(driveCacheOwnerKey(userId, choirId), choirId);
    onSaved();
  }} />;
}

function PermissionContacts({ userId, choirId, operation, isMember }: { userId: string; choirId: string; operation: Operation; isMember: boolean }) {
  const t = useMessages("library");
  return <div className="permission-lock-explanation" role="status"><p>{t("drivePermissionRequired", { operation: t(permissionMessageKeys[operation]) })}</p>{isMember && <MemberContacts userId={userId} choirId={choirId} operation={operation} />}<Link to={`/choirs/${choirId}/memberships`}>{t("driveManagementViewPermissionDivision")}</Link></div>;
}
function MemberContacts({ userId, choirId, operation }: { userId: string; choirId: string; operation: Operation }) {
  const { locale } = useAppLocale();
  const t = useMessages("library");
  const resource = useReadResource<Members>({ owner: userId, driveId: choirId, kind: "permission-contacts" }, async signal => {
    const response = await diagnosticFetch(`/api/choirs/${choirId}/memberships`, { signal });
    if (!response.ok) throw new SettingsRequestError(response.status);
    return parseDiagnosticResponse(response, managedMembershipsSchema);
  });
  const formatter = new Intl.ListFormat(locale, { type: "unit" });
  const contacts = (scope: "operations" | "management") => formatter.format(resource.data?.memberships
    .filter(member => member.status === "active" && (member.isOwner || member[scope].operations.includes(operation)))
    .map(member => member.displayName) ?? []) || t("driveManagementCloudDiskOwner");
  const operators = contacts("operations");
  const delegates = contacts("management");
  return <><p>{t("driveManagementOperationContacts", { members: operators })}</p>{operators !== delegates && <p>{t("driveManagementDelegationContacts", { members: delegates })}</p>}</>;
}
