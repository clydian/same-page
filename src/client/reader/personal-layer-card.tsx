import { useMessages } from "../../i18n";
import { isLocalExperience } from "../annotations/guest-notes";
import { useId, useRef, useState, type ReactNode } from "react";
import { Button, Heading, Modal, ModalOverlay, Switch } from "react-aria-components";
import { Dialog } from "../navigation/overlays";
import type { AnnotationLayerSummary } from "../../shared/annotations";
import type { PersonalLayerChange } from "./use-personal-layer-management";
import type { LocalWorkspace } from "../platform/local-workspace";

export function PersonalLayerCard({ layer, editing, workspace, pending, blocked, feedback, onChange, onSubscribe }: {
  layer: AnnotationLayerSummary;
  editing: boolean;
  workspace: LocalWorkspace;
  pending: boolean;
  blocked: boolean;
  feedback: ReactNode;
  onChange(change: PersonalLayerChange): Promise<boolean>;
  onSubscribe(subscribed: boolean): void;
}) {
  const t = useMessages("reader");
  const visibilityId = useId();
  const [name, setName] = useState(layer.name);
  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const renameButton = useRef<HTMLButtonElement>(null);
  const closeRename = () => { setRenaming(false); requestAnimationFrame(() => renameButton.current?.focus()); };
  const remove = async () => {
    if (await onChange({ action: "delete" })) setConfirming(false);
  };
  return <article className="layer-card">
    <div className="layer-card__main reader-layer-row">
      <label className="layer-row__name" htmlFor={editing ? undefined : visibilityId}><strong>{layer.name}</strong></label>
      {editing ? <>
        <Button ref={renameButton} className="personal-layer-row-action" aria-label={t("renameNamedLayer", { name: layer.name })} isDisabled={pending || blocked || renaming} onPress={() => { setName(layer.name); setRenaming(true); }}>{t("rename")}</Button>
        <Button className="personal-layer-row-action personal-layer-row-action--delete" aria-label={t("deleteNamedLayer", { name: layer.name })} isDisabled={pending || blocked} onPress={() => setConfirming(true)}>{t("delete")}</Button>
      </> : <>
      <label className="layer-row__visibility"><input id={visibilityId} type="checkbox" aria-label={t("showNamedLayer", { name: layer.name })} checked={layer.subscribed}
        onChange={event => onSubscribe(event.target.checked)} /></label></>}
    </div>
    <div className="personal-layer-details"><p className="personal-layer-audience">{isLocalExperience(workspace) ? t("browserOnly") : layer.sharing ? t("visibleToDriveMembers") : t("visibleOnlyToYou")}</p>
      {editing && !isLocalExperience(workspace) && <Switch className="personal-layer-share layer-row__accessory" aria-label={t("shareNamedLayer", { name: layer.name })} aria-description={t("layerSharingDescription")} isSelected={!!layer.sharing} isDisabled={pending || blocked || !layer.canShare}
        onChange={sharing => void onChange({ sharing })}><span className="personal-layer-share-track" aria-hidden="true" /><span>{t("share")}</span></Switch>}
    </div>
    {renaming && <form className="personal-layer-rename" onSubmit={event => { event.preventDefault(); void onChange({ name: name.trim() }).then(saved => { if (saved) closeRename(); }); }}>
      <input autoFocus aria-label={t("layerNameField", { name: layer.name })} maxLength={60} required value={name} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === "Escape" && !pending) { event.stopPropagation(); closeRename(); } }} />
      <button disabled={pending || blocked || !name.trim()}>{t("saveName")}</button><Button isDisabled={pending} onPress={closeRename}>{t("cancel")}</Button>
    </form>}
    {!confirming && feedback}
    {confirming && <ModalOverlay className="modal-overlay" isOpen isDismissable={!pending} onOpenChange={open => { if (!open && !pending) setConfirming(false); }}>
      <Modal className="app-modal app-modal--compact"><Dialog className="app-dialog" exitDisabled={pending}>
        <Heading slot="title">{t("deleteLayerTitle")}</Heading>
        <p>{t("deleteLayerConfirmation", { name: layer.name })}</p>
        {feedback}
        <div className="settings-actions"><Button className="secondary-button" autoFocus isDisabled={pending} onPress={() => setConfirming(false)}>{t("cancel")}</Button>
          <Button className="primary-button destructive-button" isDisabled={pending || blocked} onPress={() => void remove()}>{t("confirmDeletion")}</Button></div>
      </Dialog></Modal>
    </ModalOverlay>}
  </article>;
}
