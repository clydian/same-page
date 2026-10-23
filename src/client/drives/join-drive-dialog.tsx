import { clearGuestSession } from "../auth/preview-guest-session";
import { ArrowLeft, X } from "lucide-react";
import { activateGuestLocalOwner } from "../platform/local-workspace";
import { enterDrive, joinDrive, cancelDriveEntry, type DriveEntryResult } from "../auth/drive-entry";
import { invalidateSettingsLifetime, useSettingsLifetime } from "../settings/use-settings-lifetime";
import type { ApplicationIdentity } from "../auth/application-identity";
import { type FormEvent, useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { Button, Form, Heading, Input, Label, Modal, ModalOverlay, TextField } from "react-aria-components";
import { Dialog } from "../navigation/overlays";
import { useExitLayer } from "../navigation/navigation-context";
import { Link, useLocation, useNavigate } from "react-router-dom";
import type { ChoirSummary } from "../../shared/choirs";
import { JoinCodeField } from "../components/join-code-field";
import { readInviteLink } from "../components/invite-link";
import { JOIN_CODE_LENGTH } from "../components/join-code";
import { InviteScanner } from "./invite-scanner";

type JoinStep = { kind: "invite" } | { kind: "display-name"; choir: ChoirSummary };

// Keep the controller mounted when closed so admission can unregister its
// dialog before navigating; cancellation still owns pending entry cleanup.
type JoinDriveProps = {
  open: boolean; onClose(): void; onBack?(): void; identity: ApplicationIdentity; invitation?: ReturnType<typeof readInviteLink>;
};

export function JoinDriveDialog(props: JoinDriveProps) {
  return <JoinDriveFlow {...props} />;
}

// The page and dialog share admission, scanning, display-name and cancellation.
export function JoinDrivePanel(props: Omit<JoinDriveProps, "open" | "onBack">) {
  return <JoinDriveFlow {...props} open inline />;
}

function JoinDriveFlow({ open, onClose, identity, onBack, invitation = null, inline = false }: JoinDriveProps & { inline?: boolean }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { session } = identity;
  const userId = session.data?.user.id;
  const inviteTitleId = useId();
  const membershipTitleId = useId();
  const admissionPaused = session.isPending || (Boolean(identity.localUserId) && !identity.authenticatedUserId);
  const linkHandled = useRef(false);
  const [joinStep, setJoinStep] = useState<JoinStep>({ kind: "invite" });
  const [joinCode, setJoinCode] = useState(invitation?.code ?? "");
  const [displayName, setDisplayName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [clearingGuestSession, setClearingGuestSession] = useState(false);
  const [joinMessage, setJoinMessage] = useState<string | null>(null);
  const [entryDestination, setEntryDestination] = useState<string | null>(null);
  // Let the dialog unregister its exit guard before completing admission.
  useEffect(() => {
    if (entryDestination) {
      void navigate(entryDestination, { replace: inline });
    }
  }, [entryDestination, navigate, inline]);

  const resetJoinFlow = () => {
    setJoinStep({ kind: "invite" });
    setJoinCode("");
    setDisplayName("");
    setJoinMessage(null);
  };

  const finishJoinDialog = () => {
    onClose();
    resetJoinFlow();
  };

  const clearActiveGuestSession = async () => {
    setClearingGuestSession(true);
    await clearGuestSession();
    setClearingGuestSession(false);
  };

  const pendingEntryRef = useRef<Promise<DriveEntryResult> | null>(null);
  const entryAbortRef = useRef<AbortController | null>(null);
  useEffect(() => () => {
    entryAbortRef.current?.abort();
    const pending = pendingEntryRef.current;
    if (inline && pending) { pendingEntryRef.current = null; void cancelDriveEntry(pending); }
  }, [inline]);
  const dismissJoinDialog = () => {
    invalidateSettingsLifetime(entryLifetimeRef);
    entryAbortRef.current?.abort();
    setSubmitting(false);
    // Opening and cancelling the picker must not revoke a guest's current
    // drive cookie when no new admission has been attempted.
    const pending = pendingEntryRef.current;
    if (pending) {
      pendingEntryRef.current = null;
      setClearingGuestSession(true);
      void cancelDriveEntry(pending).finally(() => setClearingGuestSession(false));
    }
    resetJoinFlow();
    (onBack ?? onClose)();
  };

  const entryLifetimeRef = useSettingsLifetime();
  useExitLayer(inline && (submitting || clearingGuestSession || joinStep.kind === "display-name"), "form", async () => {
    if (submitting || clearingGuestSession) return false;
    invalidateSettingsLifetime(entryLifetimeRef);
    const pending = pendingEntryRef.current;
    pendingEntryRef.current = null;
    if (pending) await cancelDriveEntry(pending);
    resetJoinFlow();
    return true;
  });
  const enterInviteDrive = async (event?: FormEvent, code = joinCode) => {
    event?.preventDefault();
    if (admissionPaused || clearingGuestSession || submitting) return;
    setEntryDestination(null);
    const generation = entryLifetimeRef.current;
    setSubmitting(true); setJoinMessage(null);
    const controller = new AbortController();
    entryAbortRef.current = controller;
    const pending = enterDrive({ admission: "invite", joinCode: code }, Boolean(userId), controller.signal);
    pendingEntryRef.current = pending;
    const result = await pending;
    if (generation !== entryLifetimeRef.current) return;
    if (result.kind === "enter") {
      if (!userId) {
        try { await activateGuestLocalOwner(result.choir.id, controller.signal); }
        catch {
          if (!controller.signal.aborted) { setSubmitting(false); setJoinMessage("无法准备本机访客空间，请重试。"); }
          return;
        }
        if (generation !== entryLifetimeRef.current) return;
      }
      pendingEntryRef.current = null;
      setSubmitting(false);
      finishJoinDialog();
      setEntryDestination(`/choirs/${result.choir.id}`);
      return;
    }
    setSubmitting(false);
    if (result.kind === "display-name") {
      setJoinStep({ kind: "display-name", choir: result.choir });
    } else if (result.kind === "failed") {
      // A refused invitation never replaced the current guest credential.
      if (result.guestSessionUnchanged) pendingEntryRef.current = null;
      setJoinMessage(result.message);
    }
  };

  const enterLinkedDrive = useEffectEvent(() => {
    if (invitation?.code) void enterInviteDrive();
    else setJoinMessage("邀请链接无效，请输入当前邀请码。");
  });

  useEffect(() => {
    let active = true;
    // StrictMode disconnects and reconnects effects before this microtask.
    // Start only the committed lifetime, keeping automatic admission single-shot.
    void Promise.resolve().then(() => {
      if (!active || !open || admissionPaused || !invitation || linkHandled.current) return;
      // Router navigation can complete asynchronously. Admit only on the next
      // committed location, once the shared credential has left the address bar.
      if (location.hash) {
        void navigate({ pathname: location.pathname, search: location.search, hash: "" }, { replace: true });
        return;
      }
      linkHandled.current = true;
      enterLinkedDrive();
    });
    return () => { active = false; };
  }, [open, admissionPaused, invitation, navigate, location.pathname, location.search, location.hash]);

  const joinValidatedDrive = async (event: FormEvent) => {
    event.preventDefault();
    if (joinStep.kind !== "display-name" || submitting || admissionPaused) return;
    setEntryDestination(null);
    const generation = entryLifetimeRef.current;
    setSubmitting(true); setJoinMessage(null);
    const pending = joinDrive({ kind: "guest", choirId: joinStep.choir.id }, displayName);
    pendingEntryRef.current = pending;
    const result = await pending;
    if (generation !== entryLifetimeRef.current) return;
    setSubmitting(false);
    if (result.kind === "enter") {
      pendingEntryRef.current = null;
      finishJoinDialog(); setEntryDestination(`/choirs/${result.choir.id}`);
    } else if (result.kind === "failed") {
      if (result.restart) setJoinStep({ kind: "invite" });
      setJoinMessage(result.message);
    }
  };

  const content = (close: () => void) => (
              <>
                {!inline && <div className={onBack ? "dialog-heading dialog-heading--back" : "dialog-heading"}>
                  {onBack && <Button className="icon-button" aria-label="返回切换云盘" onPress={close}><ArrowLeft size={20} aria-hidden="true" /></Button>}
                  <div>
                    {!onBack && <p className="dialog-eyebrow">合谱 · Same Page</p>}
                    <Heading slot="title">
                      {joinStep.kind === "invite"
                        ? (userId ? "加入新云盘" : "进入云盘")
                        : `加入「${joinStep.choir.name}」`}
                    </Heading>
                  </div>
                  {!onBack && <Button className="icon-button" aria-label="关闭" onPress={close}>
                    <X size={20} aria-hidden="true" />
                  </Button>}
                </div>}
                {inline && joinStep.kind === "display-name" && <h2>加入「{joinStep.choir.name}」</h2>}

                {joinStep.kind === "invite" ? (
                  <>
                    {!inline && !userId ? <section className="membership-picker" aria-labelledby={membershipTitleId}><h3 id={membershipTitleId}>我已加入的云盘</h3><Link className="membership-login" to="/login" onClick={finishJoinDialog}>登录后查看</Link></section> : null}

                    <section
                      className="invite-section"
                      aria-labelledby={inviteTitleId}
                    >
                      <h3 id={inviteTitleId}>使用邀请卡或邀请码</h3>
                      {open && <InviteScanner disabled={submitting || clearingGuestSession || admissionPaused} onRead={code => { setJoinCode(code); void enterInviteDrive(undefined, code); }} />}
                      <Form
                        className="entry-form dialog-form"
                        onSubmit={enterInviteDrive}
                      >
                        <JoinCodeField
                          autoFocus={!inline}
                          value={joinCode}
                          onChange={setJoinCode}
                        />
                        <Button
                          type="submit"
                          isDisabled={
                            joinCode.length !== JOIN_CODE_LENGTH ||
                            submitting ||
                            clearingGuestSession ||
                            admissionPaused
                          }
                        >
                          {submitting || clearingGuestSession ? "正在验证…" : "进入"}
                        </Button>
                      </Form>
                    </section>
                  </>
                ) : (
                  <section className="join-display-name">
                    <p className="dialog-copy">
                      设置你在这个云盘中显示的名字。
                    </p>
                    <Form className="entry-form dialog-form" onSubmit={joinValidatedDrive}>
                      <TextField
                        isRequired
                        value={displayName}
                        onChange={setDisplayName}
                        maxLength={40}
                      >
                        <Label>显示名</Label>
                        <Input autoComplete="nickname" placeholder="例如：小花" autoFocus />
                      </TextField>
                      <Button type="submit" isDisabled={submitting || admissionPaused}>
                        {submitting ? "正在加入…" : "加入并进入"}
                      </Button>
                      <Button
                        type="button"
                        className="text-button"
                        isDisabled={submitting || clearingGuestSession}
                        onPress={async () => {
                          await clearActiveGuestSession();
                          setJoinStep({ kind: "invite" });
                          setDisplayName("");
                          setJoinMessage(null);
                        }}
                      >
                        返回输入邀请码
                      </Button>
                    </Form>
                  </section>
                )}
                {joinMessage ? (
                  <p className="form-message" role="alert">
                    {joinMessage}
                  </p>
                ) : null}
              </>
  );
  if (inline) return <div className="join-drive-panel">{content(() => undefined)}</div>;
  return <ModalOverlay className="modal-overlay" isOpen={open && !(invitation && location.hash)}
    onOpenChange={open => { if (!open) dismissJoinDialog(); }} isDismissable>
    <Modal className="app-modal"><Dialog className="app-dialog">{({ close }) => content(close)}</Dialog></Modal>
  </ModalOverlay>;
}
