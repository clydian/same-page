import { Plus } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "react-aria-components";
import { Link, Navigate, useLocation } from "react-router-dom";
import { useApplicationIdentity, type ApplicationIdentity } from "../auth/application-identity";
import { IdentityNotice } from "../auth/local-entry";
import { AppHeader } from "../components/app-header";
import { PersonalMenu } from "../components/personal-menu";
import { CreateDriveDialog } from "../drives/create-drive";
import { JoinDriveDialog, JoinDrivePanel } from "../drives/join-drive-dialog";
import { useDriveInvitation } from "../drives/use-drive-invitation";
import { InstallButton } from "../install/install-entry";
import { MembershipDirectoryList } from "../score-library/membership-list";
import { readLastDrive } from "../score-library/last-drive";
import { useMembershipDirectory } from "../score-library/use-membership-directory";
import "./drive-entry.css";

export default function DriveEntryPage() {
  const identity = useApplicationIdentity();
  const { invitation, finishInvitation } = useDriveInvitation();
  // Preserve an explicit admission while it prepares a different local owner.
  const owner = invitation.link ? identity.session.data?.user.id : identity.localUserId;
  return <DriveEntryContent key={`${owner ?? "guest"}:${invitation.version}`} identity={identity} invitation={invitation.link} finishInvitation={finishInvitation} />;
}

function DriveEntryContent({ identity, invitation, finishInvitation }: {
  identity: ApplicationIdentity;
  invitation: ReturnType<typeof useDriveInvitation>["invitation"]["link"];
  finishInvitation(): void;
}) {
  const location = useLocation();
  const [joinOpen, setJoinOpen] = useState(new URLSearchParams(location.search).get("join") === "1" || Boolean(invitation));
  const [createOpen, setCreateOpen] = useState(false);
  const [manualEntry, setManualEntry] = useState(joinOpen);
  const userId = identity.authenticatedUserId;
  const create = userId
    ? <Button className="text-button" onPress={() => { setManualEntry(true); setCreateOpen(true); }}><Plus size={16} aria-hidden="true" />创建云盘</Button>
    : <Link className="text-button" to="/login">登录后创建云盘</Link>;
  const finishJoin = () => { finishInvitation(); setJoinOpen(false); };
  return <div className="app-page drive-entry-page">
    <AppHeader actions={identity.session.data?.user ? <><InstallButton className="header-action" /><PersonalMenu email={identity.session.data.user.email} /></> : !identity.session.isPending && <Link className="header-action" to="/login">登录</Link>} />
    <main className="drive-entry-main">
      <IdentityNotice identity={identity} connectionControl />
      {identity.localUserId ? <MemberEntry identity={identity} userId={identity.localUserId} create={create} onJoin={() => { setManualEntry(true); setJoinOpen(true); }} admissionOpen={manualEntry || joinOpen || createOpen} />
        : identity.restoring || identity.onlineState === "checking" ? <p role="status">正在恢复本机内容…</p>
        : identity.onlineState === "signed-out" ? <FirstDrive identity={identity} create={create} />
        : <p role="status">暂时无法确认云盘目录，请连接网络后重试。</p>}
    </main>
    <JoinDriveDialog open={joinOpen} onClose={finishJoin} identity={identity} invitation={invitation} />
    {userId && <CreateDriveDialog userId={userId} open={createOpen} onOpenChange={setCreateOpen} />}
  </div>;
}

function MemberEntry({ identity, userId, create, onJoin, admissionOpen }: {
  identity: ApplicationIdentity; userId: string; create: ReactNode; onJoin(): void; admissionOpen: boolean;
}) {
  const localOnly = !identity.authenticatedUserId;
  const membership = useMembershipDirectory(userId, localOnly);
  const location = useLocation();
  const [confirmedEmpty, setConfirmedEmpty] = useState(false);
  if (membership.knownEmpty && !localOnly && !confirmedEmpty) setConfirmedEmpty(true);
  // The admission form owns this visit once opened: a successful join can
  // refresh memberships before its controller finishes guest cleanup and navigation.
  // A restored empty snapshot alone cannot establish this state.
  if (confirmedEmpty && membership.directory.authority !== "signed-out" && membership.directory.authority !== "revoked") return <FirstDrive identity={identity} create={create} />;
  const lastDrive = readLastDrive(userId);
  const missingLastDrive = location.state?.missingLastDrive === true || Boolean(lastDrive && membership.directory.data !== null && !membership.rows.some(row => row.choir.id === lastDrive && !row.unavailable));
  const available = membership.rows.filter(row => !row.unavailable);
  const target = missingLastDrive ? null : available.find(row => row.choir.id === lastDrive) ?? (available.length === 1 ? available[0] : null);
  if (target && !admissionOpen) return <Navigate to={`/choirs/${target.choir.id}`} replace />;
  return <section className="drive-entry-chooser" aria-labelledby="drive-entry-title">
    <h1 id="drive-entry-title">选择云盘</h1>
    <p className="drive-entry-copy">选择要打开的云盘。</p>
    {missingLastDrive && <p className="drive-entry-notice" role="status">上次使用的云盘已不在可访问列表中，请选择其他云盘。</p>}
    <MembershipDirectoryList membership={membership} localOnly={localOnly} replace />
    <div className="drive-entry-actions"><Button className="text-button" isDisabled={!identity.authenticatedUserId} onPress={onJoin}><Plus size={16} aria-hidden="true" />加入云盘</Button>{create}</div>
  </section>;
}

function FirstDrive({ identity, create }: { identity: ApplicationIdentity; create: ReactNode }) {
  return <section className="drive-entry-welcome" aria-labelledby="drive-entry-title">
    <h1 id="drive-entry-title">先加入你的云盘</h1>
    <p className="drive-entry-copy">使用管理员发来的邀请卡或邀请码加入。</p>
    <JoinDrivePanel identity={identity} onClose={() => undefined} />
    <div className="drive-entry-create"><p>想为团队创建云盘？</p>{create}</div>
  </section>;
}
