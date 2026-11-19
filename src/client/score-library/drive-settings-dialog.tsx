import { useMessages } from "../../i18n";
import { NAVIGATION_FRESH_MS, onNavigationSuspend } from "../settings/navigation-events";
import { useEffect, useRef, useState } from "react";
import { Button, Form, Heading, Input, Label, Modal, ModalOverlay, TextField } from "react-aria-components";
import { Dialog } from "../navigation/overlays";
import { driveNameSchema, displayNameSchema, driveSettingsSchema } from "../../shared/choirs";
import { diagnosticFetch, parseDiagnosticResponse } from "../diagnostics/diagnostics";
import { useReadResource } from "../settings/use-read-resource";
import { SettingsRequestError } from "../settings/settings-request";
import { settingsError } from "../settings/settings-error";
import { captureReadIdentity } from "../settings/read-resource";

type Settings = ReturnType<typeof driveSettingsSchema.parse>;
export function DriveSettingsDialog({ choirId, userId, field, onClose, onSaved }: {
  choirId: string; userId: string; field: "name" | "display-name"; onClose: () => void; onSaved: (value: string) => Promise<void>;
}) {
  const t = useMessages("library");
  const load = async (signal?: AbortSignal) => {
    const response = await diagnosticFetch(`/api/choirs/${choirId}/settings`, { signal, headers: { "x-same-page-owner-user-id": userId } });
    if (!response.ok) throw new SettingsRequestError(response.status);
    return parseDiagnosticResponse(response, driveSettingsSchema);
  };
  const resource = useReadResource({ owner: userId, driveId: choirId, kind: "settings" }, load, undefined, NAVIGATION_FRESH_MS);
  const fieldValue = (settings: Settings) => field === "name" ? settings.name : settings.displayName;
  const [value, setValue] = useState(() => resource.data ? fieldValue(resource.data) : "");
  const dirty = useRef(false);
  const base = useRef<Settings | null>(resource.data);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [needsRead, setNeedsRead] = useState(false);
  const recovering = useRef(false);
  const active = useRef(true);
  const saving = useRef<AbortController | null>(null);
  useEffect(() => { active.current = true; return () => { active.current = false; saving.current?.abort(); saving.current = null; }; }, []);
  useEffect(() => onNavigationSuspend(() => {
    if (!saving.current) return;
    saving.current.abort(); saving.current = null;
    setBusy(false); setNeedsRead(true);
    setMessage(t("driveSettingsSavingResultNotConfirmed"));
  }), [t]);
  useEffect(() => {
    if (recovering.current && resource.data && resource.authority === "confirmed" && resource.request === "idle" && !resource.error) {
      recovering.current = false; base.current = resource.data; setNeedsRead(false);
      setMessage(t("driveSettingsCurrentValueInputHas", { value1: String(field === "name" ? resource.data.name : resource.data.displayName) }));
    }
    if (!dirty.current && resource.data) { base.current = resource.data; setValue(field === "name" ? resource.data.name : resource.data.displayName); }
  }, [resource.data, resource.authority, resource.request, resource.error, field, t]);
  const title = field === "name" ? t("driveManagementCloudDiskName") : t("driveSettingsMyDisplayNameCloud");
  const finish = async () => {
    await onSaved(value.trim());
    if (active.current) onClose();
  };
  const save = async () => {
    const settings = base.current;
    if (!settings || busy || saving.current || !resource.canMutate || saved || needsRead) return;
    const parsed = (field === "name" ? driveNameSchema : displayNameSchema).safeParse(value);
    if (!parsed.success) { setMessage(t("driveSettingsEnterCharactersNotJust", { value1: String(field === "name" ? 100 : 40) })); return; }
    const sameIdentity = captureReadIdentity();
    const controller = new AbortController(); saving.current = controller;
    const current = () => active.current && sameIdentity() && saving.current === controller;
    setBusy(true); setMessage(null);
    let confirmed = false;
    try {
      const response = await diagnosticFetch(`/api/choirs/${choirId}/${field}`, { method: "PATCH", signal: controller.signal, headers: { "content-type": "application/json", "x-same-page-owner-user-id": userId },
        body: JSON.stringify(field === "name" ? { name: parsed.data, expectedRevision: settings.nameRevision } : { displayName: parsed.data, expectedRevision: settings.membershipRevision }) });
      if (!current()) return;
      if (response.status === 409) {
        const next = await load(); if (!current()) return;
        resource.confirm(next); base.current = next;
        setMessage(t("driveSettingsSettingHasBeenUpdated", { value1: String(fieldValue(next)) }));
        return;
      }
      if (!response.ok) throw new SettingsRequestError(response.status);
      confirmed = true;
      const result = await response.json(); if (!current()) return;
      setSaved(true);
      const next = field === "name" ? { ...settings, name: parsed.data, nameRevision: result.revision }
        : { ...settings, displayName: parsed.data, membershipRevision: result.revision };
      resource.update(driveSettingsSchema.parse(next));
      await finish();
    } catch (error) {
      if (current()) {
        setMessage(confirmed ? t("driveSettingsModificationHasBeenSaved") : settingsError(error, t("driveSettingsSavingResultNotConfirmed")));
        if (error instanceof SettingsRequestError && [401, 403].includes(error.status)) void resource.refresh().catch(() => undefined);
      }
    } finally {
      if (active.current && saving.current === controller) {
        saving.current = null; setBusy(false);
        if (!sameIdentity()) {
          setNeedsRead(true);
          setMessage(t("driveSettingsSavingResultNotConfirmed"));
        }
      }
    }
  };
  return <ModalOverlay className="modal-overlay" isOpen onOpenChange={open => { if (!open && !busy) onClose(); }} isDismissable={!busy}>
    <Modal className="app-modal"><Dialog className="app-dialog" aria-label={title}>
      <Heading slot="title">{title}</Heading>
      <Form className="entry-form" onSubmit={event => { event.preventDefault(); void save(); }}>
        <TextField value={value} onChange={next => { dirty.current = true; setValue(next); }} isDisabled={!resource.data || busy || saved} maxLength={field === "name" ? 100 : 40} isRequired><Label>{title}</Label><Input autoFocus /></TextField>
        {(message || Boolean(resource.error)) && <p role="status">{message ?? settingsError(resource.error, t("driveSettingsTemporarilyUnableUpdateExisting"))}</p>}
        {resource.loading && <p role="status">{t("driveSettingsReadingCurrentSettings")}</p>}
        {!message && !resource.error && resource.data && !resource.canMutate && !resource.loading && <p role="status">{t("driveSettingsConnectionOperationPermissionHas")}</p>}
        {(message || Boolean(resource.error)) && <Button isDisabled={busy || !resource.canRead} onPress={() => {
          if (saved) void finish().catch(() => setMessage(t("driveSettingsModificationHasBeenSaved")));
          else {
            recovering.current = needsRead; setMessage(null);
            void resource.refresh().catch(() => { recovering.current = false; });
          }
        }}>{saved ? t("driveSettingsRetryRefresh") : t("readAgain")}</Button>}
        <div className="dialog-actions"><Button className="secondary-button" isDisabled={busy} onPress={onClose}>{t("cancel")}</Button><Button className="primary-button" type="submit" isDisabled={!resource.canMutate || busy || saved || needsRead || (field === "name" && !resource.data?.canEditDriveInfo)}>{busy ? t("saving") : t("save")}</Button></div>
      </Form>
    </Dialog></Modal>
  </ModalOverlay>;
}
