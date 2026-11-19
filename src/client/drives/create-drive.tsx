import { useMessages } from "../../i18n";
import { ArrowLeft } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, Form, Heading, Input, Label, Modal, ModalOverlay, TextField } from "react-aria-components";
import { useNavigate } from "react-router-dom";
import { Dialog } from "../navigation/overlays";
import { diagnosticFetch } from "../diagnostics/diagnostics";
import { captureSettingsLifetime, useSettingsLifetime } from "../settings/use-settings-lifetime";
import { trialMessage } from "./trial-messages";

export function CreateDrive({ userId }: { userId: string }) {
  const t = useMessages("entry");
  const [open, setOpen] = useState(false);
  return <><Button className="primary-button" onPress={() => setOpen(true)}>{t("drive.create")}</Button>
    <CreateDriveDialog userId={userId} open={open} onOpenChange={setOpen} />
  </>;
}

export function CreateDriveDialog({ userId, open, onOpenChange, onBack }: { userId: string; open: boolean; onOpenChange(open: boolean): void; onBack?(): void }) {
  const t = useMessages("entry");
  const gate = useRef(false);
  const [uncertain, setUncertain] = useState(false);
  const [destination, setDestination] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lifetime = useSettingsLifetime();
  const navigate = useNavigate();
  useEffect(() => {
    if (destination && !open && !busy) {
      void navigate(destination);
    }
  }, [destination, open, busy, navigate]);
  async function create() {
    if (gate.current || uncertain) return;
    gate.current = true;
    const active = captureSettingsLifetime(lifetime);
    setBusy(true); setError(null);
    try {
      const response = await diagnosticFetch("/api/choirs", { method: "POST",
        headers: { "content-type": "application/json", "x-same-page-owner-user-id": userId },
        body: JSON.stringify({ name, displayName }) });
      const payload = await response.json();
      if (!active()) return;
      if (!response.ok) { setError(trialMessage(payload.error)); return; }
      onOpenChange(false);
      setDestination(`/choirs/${payload.choirId}`);
    } catch { if (active()) { setUncertain(true); setError(t("create.uncertain")); } }
    finally { gate.current = false; if (active()) setBusy(false); }
  }
  return <ModalOverlay className="modal-overlay" isOpen={open} isDismissable={!busy} isKeyboardDismissDisabled={busy} onOpenChange={open => { if (!open && onBack) onBack(); else onOpenChange(open); }}>
      <Modal className="app-modal"><Dialog className="app-dialog create-drive-dialog" exitDisabled={busy}>
        <div className={onBack ? "dialog-heading dialog-heading--back" : "dialog-heading"}>
          {onBack && <Button className="icon-button" aria-label={t("create.back")} isDisabled={busy} onPress={onBack}><ArrowLeft size={20} aria-hidden="true" /></Button>}
          <Heading slot="title">{t("drive.create")}</Heading>
        </div>
        <p className="create-drive-limits">{t("create.capacity")}</p>
        <Form className="entry-form" onSubmit={event => { event.preventDefault(); void create(); }}>
          <TextField isRequired maxLength={100} value={name} onChange={setName}><Label>{t("create.name")}</Label><Input autoFocus /></TextField>
          <TextField isRequired maxLength={40} value={displayName} onChange={setDisplayName}><Label>{t("create.displayName")}</Label><Input /></TextField>
          <p className="create-drive-terms">{t("create.terms")}</p>
          <details className="create-drive-rules"><summary>{t("create.rules")}</summary>
            <p>{t("create.ownerHint")}</p>
            <p>{t("create.retention")}</p>
          </details>
          {error && <p role="alert">{error}</p>}
          <Button className="primary-button" type="submit" isDisabled={busy || uncertain}>{busy ? t("create.working") : t("create.submit")}</Button>
          <Button className="secondary-button" isDisabled={busy} onPress={() => { if (onBack) onBack(); else onOpenChange(false); }}>{t("create.cancel")}</Button>
        </Form>
      </Dialog></Modal>
    </ModalOverlay>;
}
