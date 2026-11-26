import { useMessages } from "../../i18n";
import { useInputVisibility } from "../platform/use-input-visibility";
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
import { parseJoinCodeInput } from "../components/join-code";
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
export function JoinDrivePanel(props: Omit<JoinDriveProps, "open" | "onBack"> & { focused?: boolean }) {
  return <JoinDriveFlow {...props} open inline />;
}

function JoinDriveFlow({ open, onClose, identity, onBack, invitation = null, inline = false, focused = false }: JoinDriveProps & { inline?: boolean; focused?: boolean }) {
  const t = useMessages("entry");
  const viewportRef = useInputVisibility(inline ? "page" : "overlay");
  const navigate = useNavigate();
  const location = useLocation();
  const { session } = identity;
  const userId = session.data?.user.id;
  const inviteTitleId = useId();
  const membershipTitleId = useId();
  const identityUnavailable = focused && (identity.onlineState === "unreachable" || identity.onlineState === "local-unavailable");
  const waitingForIdentity = session.isPending || identityUnavailable || (Boolean(identity.localUserId) && !identity.authenticatedUserId && identity.onlineState !== "signed-out");
  const admissionPaused = waitingForIdentity || Boolean(invitation && location.hash);
  const linkHandled = useRef(false);
  const [joinStep, setJoinStep] = useState<JoinStep>({ kind: "invite" });
  const [joinCode, setJoinCode] = useState(invitation?.code ?? "");
  const [joinCodeComposing, setJoinCodeComposing] = useState(false);
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
    setJoinCodeComposing(false);
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
    if (event && joinCodeComposing) return;
    const parsedCode = parseJoinCodeInput(code).code;
    if (!parsedCode) return;
    if (admissionPaused || clearingGuestSession || submitting) return;
    setEntryDestination(null);
    const generation = entryLifetimeRef.current;
    setSubmitting(true); setJoinMessage(null);
    const controller = new AbortController();
    entryAbortRef.current = controller;
    const pending = enterDrive({ admission: "invite", joinCode: parsedCode }, Boolean(userId), controller.signal);
    pendingEntryRef.current = pending;
    const result = await pending;
    if (generation !== entryLifetimeRef.current) return;
    if (result.kind === "enter") {
      if (!userId) {
        try { await activateGuestLocalOwner(result.choir.id, controller.signal); }
        catch {
          if (!controller.signal.aborted) { setSubmitting(false); setJoinMessage(t("join.guestError")); }
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
    else setJoinMessage(t("join.invalidLink"));
  });

  useEffect(() => {
    let active = true;
    // StrictMode disconnects and reconnects effects before this microtask.
    // Start only the committed lifetime, keeping automatic admission single-shot.
    void Promise.resolve().then(() => {
      if (!active || !open || !invitation || linkHandled.current) return;
      // Router navigation can complete asynchronously. Admit only on the next
      // committed location, once the shared credential has left the address bar.
      if (location.hash) {
        void navigate({ pathname: location.pathname, search: focused ? "?join=1" : location.search, hash: "" }, { replace: true });
        return;
      }
      if (admissionPaused) return;
      linkHandled.current = true;
      enterLinkedDrive();
    });
    return () => { active = false; };
  }, [open, admissionPaused, invitation, navigate, location.pathname, location.search, location.hash, focused]);

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

  const scanner = open && <InviteScanner disabled={submitting || clearingGuestSession || admissionPaused} onRead={code => { setJoinCode(code); void enterInviteDrive(undefined, code); }} />;
  const content = (close: () => void) => (
              <>
                {!inline && <div className={onBack ? "dialog-heading dialog-heading--back" : "dialog-heading"}>
                  {onBack && <Button className="icon-button" aria-label={t("create.back")} onPress={close}><ArrowLeft size={20} aria-hidden="true" /></Button>}
                  <div>
                    {!onBack && <p className="dialog-eyebrow">合谱 · Same Page</p>}
                    <Heading slot="title">
                      {joinStep.kind === "invite"
                        ? (userId ? t("join.newDrive") : t("home.enter"))
                        : t("join.named", { name: joinStep.choir.name })}
                    </Heading>
                  </div>
                  {!onBack && <Button className="icon-button" aria-label={t("join.close")} onPress={close}>
                    <X size={20} aria-hidden="true" />
                  </Button>}
                </div>}
                {inline && joinStep.kind === "display-name" && <h2>{t("join.named", { name: joinStep.choir.name })}</h2>}

                {joinStep.kind === "invite" ? (
                  <>
                    {!inline && !userId ? <section className="membership-picker" aria-labelledby={membershipTitleId}><h3 id={membershipTitleId}>{t("join.existing")}</h3><Link className="membership-login" to="/login" onClick={finishJoinDialog}>{t("join.loginToView")}</Link></section> : null}

                    <section
                      className="invite-section"
                      aria-labelledby={inline ? undefined : inviteTitleId}
                      aria-label={inline ? t("drive.join") : undefined}
                    >
                      {!inline && <h3 id={inviteTitleId}>{t("join.invitation")}</h3>}
                      {!focused && scanner}
                      <Form
                        className="entry-form dialog-form"
                        onSubmit={enterInviteDrive}
                      >
                        <JoinCodeField
                          autoFocus={!inline}
                          value={joinCode}
                          isReadOnly={submitting || clearingGuestSession}
                          onChange={setJoinCode}
                          onCompositionChange={setJoinCodeComposing}
                        />
                        <Button
                          type="submit"
                          isDisabled={
                            !parseJoinCodeInput(joinCode).code ||
                            joinCodeComposing ||
                            submitting ||
                            clearingGuestSession ||
                            admissionPaused
                          }
                        >
                          {submitting || clearingGuestSession ? t("join.checking") : inline ? t("home.enter") : t("join.enterShort")}
                        </Button>
                      </Form>
                      {focused && waitingForIdentity && <p role="status" className="drive-entry-notice">{t(identityUnavailable ? "join.identityUnavailable" : "join.checkingIdentity")}</p>}
                      {identityUnavailable && <Button className="secondary-button" isDisabled={session.isRefetching} onPress={() => { void session.refetch().catch(() => undefined); }}>{t("startup.retry")}</Button>}
                      {focused && !admissionPaused && scanner}
                    </section>
                  </>
                ) : (
                  <section className="join-display-name">
                    <p className="dialog-copy">
                      {t("join.setName")}
                    </p>
                    <Form className="entry-form dialog-form" onSubmit={joinValidatedDrive}>
                      <TextField
                        isRequired
                        value={displayName}
                        onChange={setDisplayName}
                        maxLength={40}
                      >
                        <Label>{t("join.displayName")}</Label>
                        <Input autoComplete="nickname" placeholder={t("join.exampleName")} autoFocus />
                      </TextField>
                      <Button type="submit" isDisabled={submitting || admissionPaused}>
                        {submitting ? t("join.submitting") : t("join.submit")}
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
                        {t("join.return")}
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
  if (inline) return <div ref={viewportRef} className="join-drive-panel">{content(() => undefined)}</div>;
  return <ModalOverlay ref={viewportRef} className="modal-overlay join-drive-overlay" isOpen={open && !(invitation && location.hash)}
    onOpenChange={open => { if (!open) dismissJoinDialog(); }} isDismissable>
    <Modal className="app-modal"><Dialog className="app-dialog">{({ close }) => content(close)}</Dialog></Modal>
  </ModalOverlay>;
}
