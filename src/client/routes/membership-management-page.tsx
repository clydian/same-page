import { useAppLocale, useMessages } from "../../i18n";
import { permissionMessageKeys } from "../settings/permission-messages";
import { useSettingsIdentity } from "../auth/application-identity";
import { driveManagementSchema } from "../../shared/drive-management";
import { ViewSelector } from "../components/view-selector";
import { useReadResource } from "../settings/use-read-resource";
import { useUnsavedChanges } from "../settings/use-unsaved-changes";
import { SettingsFeedback } from "../settings/settings-feedback";
import { useSettingsMutation } from "../settings/settings-mutation";
import { SettingsRequestError, settingsError } from "../settings/settings-request";
import { PermissionMatrix } from "../settings/permission-matrix";
import { ConfirmDialog, type Confirmation } from "../settings/confirm-dialog";
import { useCallback, useEffect, useState } from "react";
import { Button } from "react-aria-components";
import { useParams } from "react-router-dom";
import { managedMembershipsSchema } from "../../shared/lifecycle";
import { allPermissions, isDelegated, operationKeys, includesLayer, type PermissionSet } from "../../shared/drive-permissions";
import { DriveSettingsContent } from "../score-library/drive-settings-content";
import { diagnosticFetch, parseDiagnosticResponse } from "../diagnostics/diagnostics";

type State = ReturnType<typeof managedMembershipsSchema.parse>;
type Member = State["memberships"][number];
type Layer = { slot: string; name: string };
export default function MembershipManagementPage() {
  const { choirId = "" } = useParams();
  const { userId, ready } = useSettingsIdentity();
  return <MembershipManagement key={`${userId ?? "guest"}:${choirId}`} choirId={choirId} userId={userId ?? "guest"} ready={ready} />;
}
function MembershipManagement({ choirId, userId, ready }: { choirId: string; userId: string; ready: boolean }) {
  const t = useMessages("library");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("active");
  const [view, setView] = useState<"member" | "permission">("member");
  const [permission, setPermission] = useState("uploadFiles");
  const [editingMember, setEditingMember] = useState("");
  const [drafts, setDrafts] = useState<Record<string, { operations: PermissionSet; management: PermissionSet }>>({});
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const load = useCallback(async (signal: AbortSignal) => {
    const overviewResponse = await diagnosticFetch(`/api/choirs/${choirId}/management`, { signal });
    if (!overviewResponse.ok) throw new SettingsRequestError(overviewResponse.status);
    const overview = await parseDiagnosticResponse(overviewResponse, driveManagementSchema);
    if (!overview.isMember) return { next: null, layers: [], overview };
    const response = await diagnosticFetch(`/api/choirs/${choirId}/memberships`, { signal });
    if (!response.ok) throw new SettingsRequestError(response.status);
    const next = await parseDiagnosticResponse(response, managedMembershipsSchema);
    const definitions = await diagnosticFetch(`/api/choirs/${choirId}/permission-layers`, { signal });
    if (!definitions.ok) throw new SettingsRequestError(definitions.status);
    return { next, layers: (await definitions.json()).layers as Layer[], overview };
  }, [choirId]);
  const resource = useReadResource({ owner: userId, driveId: choirId, kind: "memberships" }, load, undefined, 0, ready);
  const state = resource.data?.next ?? null;
  const layers = resource.data?.layers ?? [];
  const loading = resource.request === "pending";
  const mutation = useSettingsMutation({ enabled: resource.canMutate, refresh: resource.refresh, onRevoked: resource.clear });
  const { pending: busy, needsRefresh, message, refresh: reload } = mutation;
  const mutate = async (path: string, body: unknown, method = "POST", draftId?: string) =>
    await mutation.submit(
      () => diagnosticFetch(`/api/choirs/${choirId}/${path}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      { confirmed: () => {
        if (draftId) setDrafts(current => {
          const next = { ...current }; delete next[draftId]; return next;
        });
      } },
    ) === true;
  const dirtyMembers = state?.memberships.filter(member => drafts[member.id] && !sameMemberPermissions(drafts[member.id], member)) ?? [];
  const exitDialog = useUnsavedChanges({ subject: t("membershipManagementMemberPermissions"), dirty: dirtyMembers.length > 0, saveState: mutation,
    discard: () => setDrafts({}),
    save: async () => {
      for (const member of dirtyMembers) {
        if (!await mutate(`memberships/${member.id}/permissions`, { expectedRevision: member.revision, ...drafts[member.id] }, "PUT", member.id)) return false;
      }
      return true;
    },
  });
  return <DriveSettingsContent choirId={choirId} name={resource.data?.overview.name} section="memberships" className="lifecycle-page">
    {exitDialog}<header className="settings-heading"><p>{t("membershipManagementFindSomeoneAuthorityHandle")}</p></header>
    {resource.data && !resource.data.overview.isMember && <section className="management-list">
      <h2>{resource.data.overview.name}</h2>
      <p>{t("membershipManagementMembersPermissionsUsedView")}</p>
      <p>{t("membershipManagementOperationPermissionsDetermineWhat")}</p>
      <p className="permission-lock-explanation">{t("membershipManagementMemberListPersonalPermissions")}</p>
    </section>}
    {state && <>
      <ViewSelector<"member" | "permission"> label={t("membershipManagementPermissionViewingMethod")} value={view} onChange={setView} options={[{ id: "member", label: t("membershipManagementMember") }, { id: "permission", label: t("membershipManagementPermission") }]} />
      {view === "member" && <div className="member-filters"><label>{t("membershipManagementSearchMembers")}<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={t("membershipManagementDisplayNameCloudDisk")} /></label><label>{t("membershipManagementMemberStatus")}<select value={status} onChange={event => setStatus(event.target.value)}><option value="active">{t("membershipManagementActivityMembers")}</option><option value="removed">{t("membershipManagementMembersRemoved")}</option></select></label></div>}
      {dirtyMembers.length > 0 && <p role="status">{t("memberPermissionPendingCount", { count: dirtyMembers.length })}</p>}
      {view === "permission" && <div className="permission-filter"><label>{t("membershipManagementSelectPermissions")}<select value={permission} onChange={event => { setPermission(event.target.value); setEditingMember(""); }}>{operationKeys.map(key => <option key={key} value={key}>{t(permissionMessageKeys[key])}</option>)}<option value="all-layers">{t("membershipManagementEditAllSharedLayers")}</option>{layers.map(layer => <option key={layer.slot} value={`layer:${layer.slot}`}>{t("permissionMatrixEdit", { name: layer.name })}</option>)}</select></label></div>}
    </>}
    {state && view === "permission" && <>
      <PermissionPeople title={t("membershipManagementOperable")} members={state.memberships.filter(member => member.status === "active" && (member.isOwner || hasPermission(member.operations, permission)))} />
      <PermissionPeople title={t("membershipManagementAuthorized")} members={state.memberships.filter(member => member.status === "active" && (member.isOwner || hasPermission(member.management, permission)))} />
      {state.capabilities.isOwner || hasPermission(state.capabilities.management, permission) ? <details className="permission-edit-entry"><summary>{t("membershipManagementAdjustPermission")}</summary><label>{t("membershipManagementSelectMembers")}<select value={editingMember} onChange={event => setEditingMember(event.target.value)}><option value="">{t("membershipManagementSelectMemberAdjust")}</option>{state.memberships.filter(member => member.status === "active" && (state.capabilities.isOwner || !member.isOwner && !isDelegated(member.management) && member.id !== state.actorId)).map(member => <option key={member.id} value={member.id}>{member.displayName}</option>)}</select></label><p className="settings-copy">{t("membershipManagementTrusteeOnlyAdjustOrdinary")}</p></details> : <p className="settings-copy permission-note">{t("membershipManagementPermissionNotWithinScope")}</p>}
    </>}
    {state?.memberships.filter(member => view === "member" ? member.status === status && member.displayName.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) : member.id === editingMember).map(member => <MemberEditor focus={view === "permission" ? permission : undefined} key={`${member.id}:${member.revision}:${state.capabilities.isOwner}`} member={member} state={state} layers={layers} busy={mutation.blocked} draft={drafts[member.id]} cancel={() => setDrafts(current => { const next = { ...current }; delete next[member.id]; return next; })} onDraft={draft => setDrafts(current => ({ ...current, [member.id]: draft }))}
      save={(operations, management) => void mutate(`memberships/${member.id}/permissions`, { expectedRevision: member.revision, operations, management }, "PUT", member.id)}
      change={action => setConfirmation({ title: action === "restore" ? t("membershipManagementRestoreMembership") : t("membershipManagementRemoveMembers"), action: action === "restore" ? t("membershipManagementConfirmRecovery") : t("membershipManagementConfirmRemoval"), destructive: action === "remove", message: action === "restore" ? t("membershipManagementRestoreMembershipIndividualTiers") : t("membershipManagementImmediatelyRevokeMemberPermissions"), onConfirm: async () => { await mutate(`memberships/${member.id}`, { action, expectedRevision: member.revision }); } })}
      transfer={() => {
        const former = state.memberships.find(row => row.id === state.actorId)!;
        setConfirmation({ title: t("membershipManagementTransferOwnership"), action: t("membershipManagementConfirmTransfer"), message: t("membershipManagementTransferOwnershipExplicitOperation", { displayName: String(member.displayName), value2: String(describe(former.operations, layers, t)), value3: String(describe(former.management, layers, t)) }), onConfirm: async () => { await mutate("ownership", { membershipId: member.id, confirm: true }); } });
      }} />)}
    {state?.capabilities.isOwner && <AuditLog choirId={choirId!} revision={state.memberships.map(m => m.revision).join(":")} />}
    <SettingsFeedback loading={resource.loading} loadError={resource.error ? settingsError(resource.error, t("membershipManagementMemberListUpdateFailed")) : null} message={message} retry={() => void reload().catch(() => undefined)} />
    {(!resource.data || needsRefresh) && <Button className="secondary-button" isDisabled={busy || loading} onPress={() => void reload().catch(() => undefined)}>{t("membershipManagementRereadMemberList")}</Button>}
    <ConfirmDialog confirmation={confirmation} busy={busy} onClose={() => setConfirmation(null)} />
  </DriveSettingsContent>;
}
function PermissionPeople({ title, members }: { title: string; members: Member[] }) {
  const t = useMessages("library");
  return <section className="permission-people" aria-label={title}><h2>{title}<span>{t("memberCount", { count: members.length })}</span></h2>{members.length ? <ul>{members.map(member => <li key={member.id}><span>{member.displayName}</span></li>)}</ul> : <p className="settings-copy">{t("membershipManagementNoMembersYet")}</p>}</section>;
}
function describe(set: PermissionSet, layers: Layer[], t: ReturnType<typeof useMessages>): string {
  return [...set.operations.map(key => t(permissionMessageKeys[key])), ...(set.sharedLayers === "all" ? [t("membershipManagementAllSharedLayersIncluding")] : set.sharedLayers.map(slot => layers.find(layer => layer.slot === slot)?.name ?? slot))].join("、") || t("membershipManagementNone");
}
function MemberEditor({ focus, member, state, layers, busy, save, change, transfer, draft, onDraft, cancel }: { cancel(): void; focus?: string; draft?: { operations: PermissionSet; management: PermissionSet }; onDraft: (draft: { operations: PermissionSet; management: PermissionSet }) => void; member: Member; state: State; layers: Layer[]; busy: boolean; save: (operations: PermissionSet, management: PermissionSet) => void; change: (action: "remove" | "restore") => void; transfer: () => void }) {
  const t = useMessages("library");
  const { operations, management } = draft ?? member;
  const dirty = !sameMemberPermissions({ operations, management }, member);
  const owner = state.capabilities.isOwner;
  const outsideScope = Boolean(focus && !owner && !hasPermission(state.capabilities.management, focus));
  const canAuthorize = !outsideScope && (owner || (isDelegated(state.capabilities.management) && !member.isOwner && !isDelegated(member.management) && member.id !== state.actorId));
  const protectedMember = Boolean(member.isOwner) || isDelegated(member.management);
  return <details className="lifecycle-member" open={focus ? true : undefined}><summary><span className="member-identity"><span className="member-name"><h2>{member.displayName}</h2>{member.id === state.actorId && <span className="member-self">{t("membershipManagement")}</span>}</span>{member.status === "removed" && <span className="member-role">{t("membershipManagementRemoved")}</span>}</span></summary>
    {Boolean(member.isOwner) && <p>{t("driveManagementCloudDiskOwner")}</p>}
    {!focus && <><p>{t("memberOperationSummary", { permissions: describe(member.isOwner ? allPermissions() : member.operations, layers, t) })}</p>
    <p>{t("memberDelegationSummary", { permissions: describe(member.isOwner ? allPermissions() : member.management, layers, t) })}</p></>}
    {focus && <p>{t("memberPermissionSummary", { operations: t(member.isOwner || hasPermission(member.operations, focus) ? "membershipManagementOperable" : "membershipManagementInoperable"), management: t(member.isOwner || hasPermission(member.management, focus) ? "membershipManagementAuthorizeOthers" : "membershipManagementCannotAuthorizeOthers") })}</p>}
    {!canAuthorize && <p>🔒 {outsideScope ? t("membershipManagementPermissionNotWithinAuthorized") : member.isOwner || isDelegated(member.management) ? t("membershipManagementOnlyCloudDiskOwner") : member.id === state.actorId ? t("membershipManagementIfCannotAuthorizeYourself") : t("membershipManagementDoNotAuthorizedManagement")}</p>}
    {member.userDeleted ? <p>{t("membershipManagementUserDeletionRecoveryPeriod")}</p> : member.status === "active" ? <>
      {canAuthorize && <>
        {member.isOwner === 1 && <p>{t("membershipManagementOwnerAlwaysHasFull")}</p>}
        <details open={focus ? true : undefined}><summary>{t("membershipManagementEditPermissions")}</summary><PermissionMatrix focus={focus} operations={operations} management={management} onOperations={operations => onDraft({ operations, management })} onManagement={management => onDraft({ operations, management })} scope={owner ? allPermissions() : state.capabilities.management} owner={owner} layers={layers} disabled={busy} />
        <Button className="primary-button" isDisabled={busy || !dirty} onPress={() => save(operations, management)}>{t("saveMemberPermissions", { name: member.displayName })}</Button>{dirty && <><span role="status">{t("membershipManagementNotSaved")}</span><Button className="secondary-button" isDisabled={busy} onPress={cancel}>{t("membershipManagementCancelModification")}</Button></>}</details>
      </>}
      {!member.isOwner && (owner || (!protectedMember && state.capabilities.operations.operations.includes("removeMembers"))) && <details className="member-actions"><summary>{t("membershipManagementMemberOperations")}</summary>
        <div className="settings-actions"><Button className="secondary-button destructive-link" isDisabled={busy} onPress={() => change("remove")}>{t("removeMemberAction", { name: member.displayName })}</Button>
        {owner && <Button className="secondary-button" isDisabled={busy} onPress={transfer}>{t("transferOwnershipAction", { name: member.displayName })}</Button>}</div>
      </details>}
    </> : (owner || state.capabilities.operations.operations.includes("removeMembers")) && <Button className="secondary-button" isDisabled={busy || member.recoverable !== 1} onPress={() => change("restore")}>{t("restoreMemberAction", { name: member.displayName })}</Button>}
  </details>;
}
function AuditLog({ choirId, revision }: { choirId: string; revision: string }) {
  const { locale } = useAppLocale();
  const t = useMessages("library");
  const [entries, setEntries] = useState<Array<{ id: string; actorName: string; targetName: string; before: string; after: string; createdAt: number }>>([]);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { let active = true; void diagnosticFetch(`/api/choirs/${choirId}/permission-changes`).then(response => response.ok ? response.json() : Promise.reject()).then(data => { if (active) { setEntries(data.changes); setError(false); setLoading(false); } }).catch(() => { if (active) { setError(true); setLoading(false); } }); return () => { active = false; }; }, [choirId, revision, attempt]);
  return <details><summary>{t("membershipManagementRecentPermissionChangeRecords")}</summary>{loading ? <p role="status">{t("membershipManagementReadingPermissionRecords")}</p> : error ? <p role="alert">{t("membershipManagementFailedReadPermissionRecord")}<button onClick={() => { setLoading(true); setError(false); setAttempt(value => value + 1); }}>{t("membershipManagementReReadRecords")}</button></p> : !entries.length ? <p>{t("membershipManagementThereNoPermissionChange")}</p> : null}{!loading && !error && entries.map(entry => <article key={entry.id}><p>{entry.actorName} → {entry.targetName} · {new Date(entry.createdAt).toLocaleString(locale)}</p><p>{t("memberAuditBefore", { details: auditDescription(entry.before, t) })}</p><p>{t("memberAuditAfter", { details: auditDescription(entry.after, t) })}</p></article>)}</details>;
}
function auditDescription(json: string, t: ReturnType<typeof useMessages>): string {
  const entry = JSON.parse(json);
  return entry.ownerMembershipId ? t("membershipManagementTransferOwnership3") : t("membershipManagementOperationManagementScope", { value1: String(describe(entry.operations, [], t)), value2: String(describe(entry.management, [], t)) });
}

function hasPermission(set: PermissionSet, permission: string): boolean {
  return permission === "all-layers" ? set.sharedLayers === "all" : permission.startsWith("layer:") ? includesLayer(set, permission.slice(6)) : set.operations.some(key => key === permission);
}

function sameMemberPermissions(left: { operations: PermissionSet; management: PermissionSet }, right: { operations: PermissionSet; management: PermissionSet }) {
  const same = (a: PermissionSet, b: PermissionSet) => a.operations.length === b.operations.length && a.operations.every(operation => b.operations.includes(operation))
    && (a.sharedLayers === "all" || b.sharedLayers === "all" ? a.sharedLayers === b.sharedLayers : a.sharedLayers.length === b.sharedLayers.length && a.sharedLayers.every(slot => b.sharedLayers.includes(slot)));
  return same(left.operations, right.operations) && same(left.management, right.management);
}
