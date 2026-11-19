import { FeedbackMessage } from "../components/feedback-message";
import { useFeedbackMessage } from "../components/use-feedback-message";
import { useAppLocale, useMessages, type AppLocale } from "../../i18n";
import { useSettingsLifetime, captureSettingsLifetime, invalidateSettingsLifetime } from "../settings/use-settings-lifetime";
import { captureReadIdentity } from "../settings/read-resource";
import { SettingsRequestError, isSettingsReadDenied } from "../settings/settings-request";
import { settingsError } from "../settings/settings-error";
import { ConfirmDialog } from "../settings/confirm-dialog";
import { Copy, Download, Share2, Link as LinkIcon } from "lucide-react";
import { InviteCard } from "./invite-card";
import { createInviteCardFile, deliverInviteCard } from "./save-invite-card";
import { createInviteLink } from "../components/invite-link";
import { useRef, useEffect, useEffectEvent, useState, type FormEvent } from "react";
import { Button, Form } from "react-aria-components";

import { currentJoinCodeResponseSchema, rotateJoinCodeResponseSchema } from "../../shared/choirs";
import { JoinCodeField } from "../components/join-code-field";
import { diagnosticFetch, parseDiagnosticResponse } from "../diagnostics/diagnostics";
import { parseJoinCodeInput } from "../components/join-code";

export function InviteSharing({ choirId, choirName, writable = true }: { choirId: string; choirName: string; writable?: boolean }) {
  const { locale } = useAppLocale();
  const t = useMessages("library");
  const lifetime = useSettingsLifetime(writable);
  const cardRef = useRef<SVGSVGElement>(null);
  const [confirmRotation, setConfirmRotation] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [currentCode, setCurrentCode] = useState<string | null>(null);
  const [cardFile, setCardFile] = useState<{ code: string; choirName: string; locale: AppLocale; file: File } | null>(null);
  const [cardError, setCardError] = useState(false);
  const [cardAttempt, setCardAttempt] = useState(0);
  const [originalCode, setOriginalCode] = useState("");
  const [originalCodeComposing, setOriginalCodeComposing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const feedback = useFeedbackMessage();
  const { message, setMessage } = feedback;
  const [reload, setReload] = useState(0);
  const endpoint = `/api/choirs/${choirId}/join-code`;
  const reportReadFailure = useEffectEvent((error: unknown) => {
    setMessage(settingsError(error, t("inviteSharingInvitationCodeCannotRead")));
  });

  useEffect(() => {
    if (!writable) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await diagnosticFetch(endpoint, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new SettingsRequestError(response.status);
        const { joinCode } = await parseDiagnosticResponse(response, currentJoinCodeResponseSchema);
        if (controller.signal.aborted) return;
        setCurrentCode(joinCode);
        setLoaded(true);
        setMessage(null);
      } catch (error) {
        if (!controller.signal.aborted) {
          if (isSettingsReadDenied(error)) {
            invalidateSettingsLifetime(lifetime);
            setCurrentCode(null); setCardFile(null); setLoaded(false); setOriginalCode(""); setConfirmRotation(false);
          }
          reportReadFailure(error);
        }
      }
    })();
    return () => controller.abort();
  }, [endpoint, reload, writable, lifetime, setMessage]);

  if (confirmRotation && !writable) setConfirmRotation(false);

  // Prepare before the share press so navigator.share retains user activation.
  useEffect(() => {
    if (!currentCode || !cardRef.current) return;
    let active = true;
    void createInviteCardFile(cardRef.current, locale).then(file => {
      if (active) { setCardFile({ code: currentCode, choirName, locale, file }); setCardError(false); }
    }).catch(() => { if (active) setCardError(true); });
    return () => { active = false; };
  }, [currentCode, choirName, cardAttempt, locale]);
  const readyFile = cardFile?.code === currentCode && cardFile.choirName === choirName && cardFile.locale === locale ? cardFile.file : null;

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setMessage(t("inviteSharingHasBeenCopied", { label }), { duration: 5000 });
    } catch {
      setMessage(t("inviteSharingCopyingFailedTryAgain"));
    }
  }

  async function deliver(share: boolean) {
    if (!readyFile) return;
    setSharing(true);
    try {
      const result = await deliverInviteCard(readyFile, share);
      setMessage(result === "saved" ? t("inviteSharingInvitationCardHasBeen") : null, { duration: 5000 });
    } catch {
      setMessage(t("inviteSharingInvitationCardGenerationSharing"));
    } finally {
      setSharing(false);
    }
  }

  async function rotate() {
    if (!writable || !loaded) return;
    const sameIdentity = captureReadIdentity();
    const sameLifetime = captureSettingsLifetime(lifetime);
    const current = () => sameIdentity() && sameLifetime();
    setBusy(true);
    setMessage(null);
    try {
      const response = await diagnosticFetch(`${endpoint}/rotate`, { method: "POST" });
      if (!current()) return;
      if (!response.ok) throw new Error("rotation_failed");
      const rotated = await parseDiagnosticResponse(response, rotateJoinCodeResponseSchema);
      if (!current()) return;
      setCurrentCode(rotated.joinCode);
      setMessage(t("inviteSharingInvitationCodeHasBeen"), { duration: 5000 });
    } catch {
      if (!current()) return;
      setMessage(t("inviteSharingInvitationCodeRotationFailed"));
      setLoaded(false);
      setCurrentCode(null);
    } finally {
      setBusy(false);
      if (!current()) { setLoaded(false); setReload(value => value + 1); }
    }
  }

  async function saveOriginal(event: FormEvent) {
    event.preventDefault();
    const parsedCode = parseJoinCodeInput(originalCode).code;
    if (!writable || !loaded || busy || originalCodeComposing || !parsedCode) return;
    const sameIdentity = captureReadIdentity();
    const sameLifetime = captureSettingsLifetime(lifetime);
    const current = () => sameIdentity() && sameLifetime();
    setBusy(true);
    setMessage(null);
    try {
      const response = await diagnosticFetch(endpoint, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ joinCode: parsedCode }),
      });
      if (!current()) return;
      if (!response.ok) {
        setMessage(response.status === 409 ? t("inviteSharingOriginalCodeEnteredInconsistent") : t("inviteSharingInvitationCodeCannotSaved"));
        return;
      }
      setCurrentCode(parsedCode);
      setOriginalCode("");
      setMessage(t("inviteSharingHasBeenSavedOriginal"), { duration: 5000 });
    } catch {
      if (!current()) return;
      setMessage(t("inviteSharingInvitationCodeCannotSaved"));
    } finally {
      setBusy(false);
      if (!current()) { setLoaded(false); setReload(value => value + 1); }
    }
  }

  return (
    <section className="invite-sharing-dialog invite-sharing-page" aria-label={t("inviteSharingInvitationJoinCloudDisk")}>
          {currentCode ? (
            <>
              <InviteCard ref={cardRef} choirName={choirName} code={currentCode} link={createInviteLink(window.location.origin, currentCode)} />
              <div className="invite-share-actions">
                <Button className="secondary-button" isDisabled={!writable || !loaded || busy || sharing} onPress={() => void copy(createInviteLink(window.location.origin, currentCode), t("inviteSharingInvitationLink"))}><LinkIcon size={18} />{t("inviteSharingCopyInvitationLink")}</Button>
                <Button className="secondary-button" isDisabled={!writable || !loaded || busy || sharing} onPress={() => void copy(currentCode, t("inviteCode"))}><Copy size={18} />{t("inviteSharingCopyInvitationCode")}</Button>
                <Button className="secondary-button" isDisabled={!writable || !loaded || busy || sharing || !readyFile} onPress={() => void deliver(true)}><Share2 size={18} />{t("inviteSharingShareInvitationCard")}</Button>
                <Button className="secondary-button" isDisabled={!writable || !loaded || busy || sharing || !readyFile} onPress={() => void deliver(false)}><Download size={18} />{t("inviteSharingSaveInvitationCard")}</Button>
              </div>
              {cardError && <p role="alert">{t("inviteSharingFailedGenerateInvitationCard")}<Button onPress={() => { setCardError(false); setCardAttempt(value => value + 1); }}>{t("inviteSharingRegenerate")}</Button></p>}
            </>
          ) : loaded ? (
            <>
              <p className="drive-management-copy">{t("inviteSharingCurrentInvitationCodeHas")}</p>
              <Form className="entry-form" onSubmit={saveOriginal}>
                <JoinCodeField value={originalCode} onChange={setOriginalCode} onCompositionChange={setOriginalCodeComposing} />
                <Button type="submit" isDisabled={!writable || busy || originalCodeComposing || !parseJoinCodeInput(originalCode).code}>{t("inviteSharingSaveOriginalInvitationCode")}</Button>
              </Form>
            </>
          ) : !message ? <p role="status">{t("inviteSharingReadingInvitationCode")}</p> : null}
          <div className="invite-rotation"><p className="drive-management-copy">{t("inviteSharingAfterRotationOldInvitation")}</p>
          <Button className="secondary-button" isDisabled={!writable || !loaded || busy || sharing} onPress={() => setConfirmRotation(true)}>
            {busy ? t("saving") : t("inviteSharingRotatingInvitationCode")}
          </Button>
          </div><ConfirmDialog confirmation={confirmRotation && writable ? { title: t("inviteSharingRotatingInvitationCode"), action: t("inviteSharingConfirmRotation"), message: t("inviteSharingCurrentInvitationCodeInvitation"), onConfirm: rotate } : null} busy={busy} onClose={() => setConfirmRotation(false)} />
          <FeedbackMessage feedback={feedback} className="library-message" />
          {!loaded && message ? <Button isDisabled={!writable} onPress={() => setReload((value) => value + 1)}>{t("retry")}</Button> : null}
    </section>
  );
}
