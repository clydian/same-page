import { clearGuestSession } from "../auth/preview-guest-session";
import { X } from "lucide-react";
import { activateGuestLocalOwner } from "../platform/local-workspace";
import { enterDrive, joinDrive, cancelDriveEntry, type DriveEntryResult } from "../auth/drive-entry";
import { invalidateSettingsLifetime, useSettingsLifetime } from "../settings/use-settings-lifetime";
import type { ApplicationIdentity } from "../auth/application-identity";
import { type FormEvent, useEffect, useEffectEvent, useRef, useState } from "react";
import { Button, Form, Heading, Input, Label, Modal, ModalOverlay, TextField } from "react-aria-components";
import { Dialog } from "../navigation/overlays";
import { Link, useLocation, useNavigate } from "react-router-dom";
import type { ChoirSummary } from "../../shared/choirs";
import { JoinCodeField } from "../components/join-code-field";
import { readInviteLink } from "../components/invite-link";
import { JOIN_CODE_LENGTH } from "../components/join-code";

type JoinStep = { kind: "invite" } | { kind: "display-name"; choir: ChoirSummary };

// Keep the controller mounted when closed so admission can unregister its
// dialog before navigating; cancellation still owns pending entry cleanup.
export function JoinDriveDialog({ open, onClose, identity, invitation = null }: {
  open: boolean; onClose(): void; identity: ApplicationIdentity; invitation?: ReturnType<typeof readInviteLink>;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { session } = identity;
  const userId = session.data?.user.id;
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
      void navigate(entryDestination);
    }
  }, [entryDestination, navigate]);

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
  useEffect(() => () => entryAbortRef.current?.abort(), []);
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
    finishJoinDialog();
  };

  const entryLifetimeRef = useSettingsLifetime();
  const enterInviteDrive = async (event?: FormEvent) => {
    event?.preventDefault();
    if (clearingGuestSession || submitting) return;
    setEntryDestination(null);
    const generation = entryLifetimeRef.current;
    setSubmitting(true); setJoinMessage(null);
    const controller = new AbortController();
    entryAbortRef.current = controller;
    const pending = enterDrive({ admission: "invite", joinCode }, Boolean(userId), controller.signal);
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
      setSubmitting(false);
      finishJoinDialog();
      setEntryDestination(`/choirs/${result.choir.id}`);
      return;
    }
    setSubmitting(false);
    if (result.kind === "display-name") {
      setJoinStep({ kind: "display-name", choir: result.choir });
    } else if (result.kind === "failed") setJoinMessage(result.message);
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
      if (!active || !open || session.isPending || !invitation || linkHandled.current) return;
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
  }, [open, session.isPending, invitation, navigate, location.pathname, location.search, location.hash]);

  const joinValidatedDrive = async (event: FormEvent) => {
    event.preventDefault();
    if (joinStep.kind !== "display-name" || submitting) return;
    setEntryDestination(null);
    const generation = entryLifetimeRef.current;
    setSubmitting(true); setJoinMessage(null);
    const pending = joinDrive({ kind: "guest", choirId: joinStep.choir.id }, displayName);
    pendingEntryRef.current = pending;
    const result = await pending;
    if (generation !== entryLifetimeRef.current) return;
    setSubmitting(false);
    if (result.kind === "enter") {
      finishJoinDialog(); setEntryDestination(`/choirs/${result.choir.id}`);
    } else if (result.kind === "failed") {
      if (result.restart) setJoinStep({ kind: "invite" });
      setJoinMessage(result.message);
    }
  };

  return (
      <ModalOverlay
        className="modal-overlay"
        isOpen={open && !(invitation && location.hash)}
        onOpenChange={(open) => {
          if (!open) dismissJoinDialog();
        }}
        isDismissable
      >
        <Modal className="app-modal">
          <Dialog className="app-dialog">
            {({ close }) => (
              <>
                <div className="dialog-heading">
                  <div>
                    <p className="dialog-eyebrow">合谱 · Same Page</p>
                    <Heading slot="title">
                      {joinStep.kind === "invite"
                        ? (userId ? "加入新云盘" : "进入云盘")
                        : `加入「${joinStep.choir.name}」`}
                    </Heading>
                  </div>
                  <Button className="icon-button" aria-label="关闭" onPress={close}>
                    <X size={20} aria-hidden="true" />
                  </Button>
                </div>

                {joinStep.kind === "invite" ? (
                  <>
                    {!userId ? <section className="membership-picker" aria-labelledby="membership-title"><h3 id="membership-title">我已加入的云盘</h3><Link className="membership-login" to="/login" onClick={finishJoinDialog}>登录后查看</Link></section> : null}

                    <section
                      className="invite-section"
                      aria-labelledby="invite-entry-title"
                    >
                      <h3 id="invite-entry-title">使用邀请码进入新的云盘</h3>
                      <Form
                        className="entry-form dialog-form"
                        onSubmit={enterInviteDrive}
                      >
                        <JoinCodeField
                          autoFocus
                          value={joinCode}
                          onChange={setJoinCode}
                        />
                        <Button
                          type="submit"
                          isDisabled={
                            joinCode.length !== JOIN_CODE_LENGTH ||
                            submitting ||
                            clearingGuestSession ||
                            session.isPending
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
                      <Button type="submit" isDisabled={submitting}>
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
            )}
          </Dialog>
        </Modal>
      </ModalOverlay>
  );
}
