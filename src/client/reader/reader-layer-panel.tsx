import { useMessages } from "../../i18n";
import { GUEST_NOTE_LAYER_ID, isLocalExperience } from "../annotations/guest-notes";
import { useReadingPreferenceProjection } from "./reading-preference-intents";
import { loginHref } from "../auth/login-return";
import { useId, useRef, useState } from "react";
import { PersonalLayerCard } from "./personal-layer-card";
import { Link } from "react-router-dom";
import { Button, Tabs, TabList, Tab, TabPanel } from "react-aria-components";

import type { AnnotationLayerSummary } from "../../shared/annotations";
import { usePersonalLayerManagement } from "./use-personal-layer-management";
import { useReadingPreferences } from "./use-reading-preferences";
import { type LocalWorkspace } from "../platform/local-workspace";
import "./reader-ux.css";

type PreferenceChange = { layer: AnnotationLayerSummary; subscribed?: boolean | null; colorOverride?: string | null };

type ReaderLayerPanelProps = {
  workspace: LocalWorkspace;
  layers: AnnotationLayerSummary[];
  signedIn: boolean;
  initialTab?: "display" | "manage";
};

export function ReaderLayerPanel(props: ReaderLayerPanelProps) {
  return <ReaderLayerPanelContent key={`${props.workspace.scopeKey}:${props.workspace.sessionEpoch ?? ""}`} {...props} />;
}

function ReaderLayerPanelContent({ workspace, layers: storedLayers, signedIn, initialTab = "display" }: ReaderLayerPanelProps) {
  const t = useMessages("reader");
  const visibilityPrefix = useId();
  const managementTrigger = useRef<HTMLButtonElement>(null);
  const personal = usePersonalLayerManagement(workspace, signedIn);
  const { creating, pending, deleted, deletedLoaded, feedback } = personal;
  const [panel, setPanel] = useState<string>(initialTab);
  const editing = panel === "manage";
  const [managing, setManaging] = useState(false);
  const [newName, setNewName] = useState("");
  const preferences = useReadingPreferences(workspace, signedIn);
  const projectedLayers = useReadingPreferenceProjection(workspace, storedLayers);
  const layers = preferences.projectLayers(projectedLayers)
    .map(layer => layer.id === GUEST_NOTE_LAYER_ID ? { ...layer, name: t("previewNotes") } : layer);
  const sharedLayers = layers.filter((layer) => layer.kind === "shared");
  const personalLayers = layers.filter((layer) => layer.kind === "personal" && layer.canEdit);
  const publishedLayers = layers.filter(layer => layer.kind === "personal" && !layer.canEdit);
  const overriddenLayers = sharedLayers.filter((layer) => layer.scoreSubscriptionOverride !== null || layer.scoreColorOverride != null);

  const save = (changes: PreferenceChange[]) => Promise.all(changes.map(({ layer, ...change }) =>
    preferences.save({ kind: "shared", id: layer.sharedSlot! }, change)));
  const preferenceFeedback = (kind: "shared" | "personal", id: string) => {
    const result = preferences.feedback({ kind, id });
    return result ? <div className="reader-layer-feedback"><p role="status">{result.message}</p>
      {result.retry && <Button onPress={result.retry}>{t("retry")}</Button>}</div> : null;
  };

  const mutationFeedback = (target: string | null, inManagement = false, showName = false) => feedback?.target === target && feedback.inDeleted === inManagement && (pending || feedback.message)
    ? <div className="reader-layer-feedback">{showName && feedback.name && <strong>{feedback.name}</strong>}<p role="status">{pending ? t("processing") : feedback.message}</p>{personal.retry && <Button isDisabled={pending} onPress={() => void personal.retry?.()}>{t("retry")}</Button>}</div> : null;

  const managementOpen = editing && managing;
  const missingFeedbackRow = feedback?.target != null && !(feedback.inDeleted ? (managing ? deleted : []) : personalLayers).some(layer => layer.id === feedback.target);
  const feedbackOutsideManagement = feedback?.inDeleted && !managementOpen;

  const personalSection = (personalLayers.length > 0 || signedIn) && <div className="layer-section layer-section--personal">
        <div className="layer-section__heading"><h3>{t("personalLayer")}</h3></div>
        {mutationFeedback(null)}{(feedbackOutsideManagement || (!feedback?.inDeleted && missingFeedbackRow)) && mutationFeedback(feedback?.target ?? null, feedback?.inDeleted, true)}
        {personalLayers.map(layer => <div key={layer.id}><PersonalLayerCard key={`${layer.id}-${editing}`} editing={editing} layer={layer} workspace={workspace} pending={pending} blocked={personal.blocked} feedback={mutationFeedback(layer.id)}
          onChange={change => personal.change(layer, change)}
          onSubscribe={subscribed => void preferences.save({ kind: "personal", id: layer.id }, { subscribed })} />{preferenceFeedback("personal", layer.id)}</div>)}
        {signedIn && editing && <>
          <div className="personal-layer-footer">
            {editing && <Button ref={managementTrigger} className="personal-layer-more" isDisabled={personal.blocked} onPress={() => { setManaging(true); void personal.loadDeleted(); }}>{t("deletedPersonalLayers")}</Button>}
            {!creating && <Button className="personal-layer-create" isDisabled={personal.blocked} onPress={() => { setNewName(""); personal.startCreation(); }}>{t("addPersonalLayer")}</Button>}

          </div>
          {creating && <form onSubmit={event => { event.preventDefault(); void personal.create(newName); }}>
            <input aria-label={t("newPersonalLayerName")} placeholder={t("examplePersonalLayer")} required maxLength={60} value={newName} onChange={event => setNewName(event.target.value)} />
            <button disabled={personal.blocked || !newName.trim()}>{t("createPersonalLayer")}</button>
          <Button isDisabled={pending} onPress={personal.cancelCreation}>{t("cancel")}</Button>
          </form>}
          {editing && managing && <section className="personal-layer-management" aria-label={t("deletedPersonalLayers")}>
            <div className="layer-section__heading"><h4>{t("deletedPersonalLayers")}</h4><Button onPress={() => { setManaging(false); requestAnimationFrame(() => managementTrigger.current?.focus()); }}>{t("close")}</Button></div>
            {mutationFeedback(null, true)}{feedback?.inDeleted && missingFeedbackRow && mutationFeedback(feedback?.target ?? null, true, true)}{managing && pending && <p role="status">{t("updatingPersonalLayers")}</p>}
          {managing && deletedLoaded && !pending && deleted.length === 0 && <p className="reader-layer-help" role="status">{t("noDeletedPersonalLayers")}</p>}
          {managing && deleted.map(layer => <div key={layer.id}>{layer.name}<Button isDisabled={personal.blocked}
            onPress={() => void personal.change(layer, { action: "restore" })}>{t("restoreNamedLayer", { name: layer.name })}</Button>{mutationFeedback(layer.id, true)}</div>)}
          </section>}

        </>}
      </div>;

  return (
    <section className="reader-layer-panel" aria-label={t("noteLayers")} aria-busy={pending}>
      <Tabs selectedKey={panel} onSelectionChange={key => setPanel(String(key))} className="reader-layer-tabs">
        <TabList aria-label={t("layerOptions")}><Tab id="display">{t("show")}</Tab><Tab id="manage">{t("manage")}</Tab></TabList>
        <TabPanel id="display">
      <p className="reader-layer-help">{t("layerDisplayHelp")}</p>
      <div className="layer-section">
        <div className="layer-section__heading">
          <div><h3>{t("sharedLayer")}</h3></div>
          <div className="layer-section__actions">
            <span>{t("visibleLayerCount", { visible: sharedLayers.filter((layer) => layer.subscribed).length, total: sharedLayers.length })}</span>
            {overriddenLayers.length > 0 ? (
              <Button className="layer-section__restore"
                aria-description={t("resetLayerDisplayDescription")}
                onPress={() => void save(overriddenLayers.map((layer) => ({ layer, subscribed: null, colorOverride: null })))}>
                {t("resetLayerDisplay")}
              </Button>
            ) : null}
          </div>
        </div>
        <div className="layer-card-list">
          {sharedLayers.map((layer) => (
            <article className="layer-card" key={layer.id}>
              <div className="layer-card__main reader-layer-row">
                <label className="layer-row__name" htmlFor={`${visibilityPrefix}-${layer.id}`}><strong>{layer.name}</strong></label>
                <label className="reader-layer-color" title={t("displayColor")}><span style={{ background: layer.displayColor }} /><input type="color" aria-label={t("namedLayerColor", { name: layer.name })} value={layer.displayColor}
                  onChange={event => void save([{ layer, colorOverride: event.target.value }])} /></label>
                <label className="layer-row__visibility"><input id={`${visibilityPrefix}-${layer.id}`} aria-label={t("showNamedLayer", { name: layer.name })}
                  checked={layer.subscribed} type="checkbox"
                  onChange={event => void save([{ layer, subscribed: event.target.checked }])} /></label>
              </div>
              {preferenceFeedback("shared", layer.sharedSlot!)}
            </article>
          ))}
        </div>
      </div>
      <div className="reader-layer-preferences">{isLocalExperience(workspace) ? <span>{t("localPreviewDisplay")}</span> : signedIn ? <Link to={`/choirs/${workspace.choirId}/preferences`}>{t("driveDisplayDefaults")}</Link> : <Link to={loginHref(`/choirs/${workspace.choirId}/scores/${workspace.scoreId}`, "layers")}>{t("signInForDisplayDefaults")}</Link>}</div>
      {personalSection}
      {publishedLayers.length ? <div className="layer-section"><h3>{t("memberShares")}</h3>
        <p className="reader-layer-help">{t("memberSharesReadOnly")}</p>
        <div className="layer-card-list">{publishedLayers.map(layer => <article className="layer-card" key={layer.id}>
          <div className="layer-card__main reader-layer-row"><label className="layer-row__name" htmlFor={`${visibilityPrefix}-${layer.id}`}><strong>{layer.name}</strong></label>
            <label className="layer-row__visibility"><input id={`${visibilityPrefix}-${layer.id}`} type="checkbox" aria-label={t("showNamedLayer", { name: layer.name })} checked={layer.subscribed}
              onChange={event => void preferences.save({ kind: "personal", id: layer.id }, { subscribed: event.target.checked })} /></label>
          </div>{preferenceFeedback("personal", layer.id)}
        </article>)}</div>
      </div> : null}
        </TabPanel>
        <TabPanel id="manage">
          <p className="reader-layer-help">{t("managePersonalLayersHelp")}</p>
          {!signedIn && <p className="reader-layer-help">{isLocalExperience(workspace) ? t("localPreviewLayersHelp") : t("signInToManageLayers")}</p>}
          {personalSection}
        </TabPanel>
      </Tabs>
    </section>
  );
}
