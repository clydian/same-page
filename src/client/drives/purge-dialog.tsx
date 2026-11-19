import { useMessages } from "../../i18n";
import { useRef, useState } from "react";
import { Button, Form, Heading, Input, Label, Modal, ModalOverlay, TextField } from "react-aria-components";
import { Dialog } from "../navigation/overlays";
import { diagnosticFetch } from "../diagnostics/diagnostics";
import { captureSettingsLifetime, useSettingsLifetime } from "../settings/use-settings-lifetime";
import { trialMessage } from "./trial-messages";

export function PurgeDialog({ userId, path, title, description, driveName, onClose, onComplete }: {
  userId: string; path: string; title: string; description: string; driveName?: string; onClose(): void; onComplete(isCurrent: () => boolean): void | Promise<void>;
}) {
  const t = useMessages("entry");
  const gate = useRef(false);
  const [blocked, setBlocked] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lifetime = useSettingsLifetime();
  async function purge() {
    if (gate.current || blocked) return;
    gate.current = true;
    let confirmed = false;
    const active = captureSettingsLifetime(lifetime);
    setBusy(true); setError(null);
    try {
      const response = await diagnosticFetch(path, { method: "POST", headers: { "content-type": "application/json", "x-same-page-owner-user-id": userId },
        body: JSON.stringify({ confirm: true, ...(driveName ? { name } : {}) }) });
      if (!active()) return;
      if (!response.ok) { const payload = await response.json().catch(() => null); setError(trialMessage(payload?.error)); return; }
      confirmed = true;
      await onComplete(active);
    } catch { if (active()) { setBlocked(true); setError(confirmed ? t("purge.refreshFailed") : t("purge.unconfirmed")); } }
    finally { gate.current = false; if (active()) setBusy(false); }
  }
  return <ModalOverlay className="modal-overlay" isOpen isDismissable={!busy} isKeyboardDismissDisabled={busy} onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <Modal className="app-modal"><Dialog className="app-dialog" role="alertdialog" exitDisabled={busy}>
      <Heading slot="title">{title}</Heading><p>{description}</p><p>{t("purge.warning")}</p>
      <Form className="entry-form purge-confirmation" onSubmit={event => { event.preventDefault(); void purge(); }}>
        {driveName && <TextField isRequired value={name} onChange={setName}><Label>{t("purge.name", { name: driveName })}</Label><Input autoFocus /></TextField>}
        {error && <p role="alert">{error}</p>}
        <Button className="secondary-button" isDisabled={busy} onPress={onClose}>{t("create.cancel")}</Button>
        <Button className="primary-button destructive-button" type="submit" isDisabled={busy || blocked || Boolean(driveName && name !== driveName)}>{busy ? t("purge.working") : t("purge.confirm")}</Button>
      </Form>
    </Dialog></Modal>
  </ModalOverlay>;
}
