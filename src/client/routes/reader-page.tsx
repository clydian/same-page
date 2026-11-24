import { useAppLocale, useMessages } from "../../i18n";
import { readerHref } from "../reader/reader-entry";
import { ReaderDisplayNotice } from '../reader/reader-display-notice';
import { GuestNoteDialog } from "../auth/guest-note-invitation";
import { ComparisonPdf } from "../playback/comparison-pdf";
import { playbackStore, playbackViewStore } from "../playback/playback-store";
import { ReaderGuide } from "../reader/reader-guide";
import { useReaderHint } from "../reader/use-reader-hint";
import { readerOpeningFacts, readerOpeningLabel } from "../reader/reader-opening";
import { MAX_READER_ZOOM } from "../reader/reader-zoom";
import { useReaderFullscreen } from "../reader/use-reader-fullscreen";
import { clearGuestNotes, GUEST_NOTE_LAYER_ID } from "../annotations/guest-notes";
import { useReadingPreferenceProjection } from "../reader/reading-preference-intents";
import { loginHref } from "../auth/login-return";
import { useLocation, useNavigate, useNavigationType } from "react-router-dom";
import { useReturnState } from "../navigation/navigation-context";
import { useReaderSync } from "../reader/use-reader-sync";
import { useToolColor } from "../reader/use-tool-color";
import { offlinePreparationDescription } from "../offline/offline-score-status";
import { ExportDialog } from "../reader/export-dialog";
import { scoreDisplayName } from "../../shared/score-display-name";
import { BackButton } from "../navigation/back-button";
import { ReaderLoading } from "../navigation/reader-loading";
import { useAppNavigation, useExitLayer } from "../navigation/navigation-context";
import { ReaderPresentationContext, useReaderPresentation } from "../reader/use-reader-presentation";
import "../reader/reader-ux.css";
import "../playback/practice-player.css";
import { useReaderSession } from "../reader/use-reader-session";
import {
  ArrowLeft, Share, HardDrive, Ellipsis, Layers, Maximize2, Minus, Pencil, Plus, BookOpen,
  RefreshCw, Rows3, X, Maximize, ChevronDown,
} from "lucide-react";
import {
  useEffect,
  useCallback,
  lazy,
  useRef,
  useState,
  Suspense,
  useSyncExternalStore,
} from "react";
import {
  Button, Tooltip, TooltipTrigger, Modal, ModalOverlay, Popover,
} from "react-aria-components";
import { Dialog } from "../navigation/overlays";
import { Link, useParams } from "react-router-dom";

import type { AnnotationLayerSummary } from "../../shared/annotations";
import type {
  AnnotationOverlayInteraction,
} from "../annotations/annotation-overlay";
import { useAnnotationEditor } from "../annotations/use-annotation-editor";
import type { AnnotationEditor } from "../annotations/annotation-editor";
import { useApplicationIdentity } from "../auth/application-identity";
import { IdentityNotice } from "../auth/local-entry";
import {
  ensureLoadingJourney,
  startLoadingJourney,
} from "../performance/loading-performance";
import { useReaderWorkspace } from "../reader/use-reader-workspace";
import { useOfflineScore } from "../offline/use-offline-score";
import { driveCacheOwnerKey } from "../score-library/drive-library-cache";
import { recordScoreOpened } from "../score-library/library-view-state";
import {
  type AnnotationPageProps,
  ContinuousLayout,
  PageLayout,
  PageNavigatorPanel,
} from "../reader/reader-layouts";
import {
  type ReaderLayout,
  useReaderPreferences,
} from "../reader/use-reader-preferences";
import { usePagedReader } from "../reader/use-paged-reader";
import { ReaderConflictDialog } from "../reader/reader-conflict-dialog";

import type { DiagnosticReader } from "../../shared/diagnostic-report";
import { DiagnosticReportDialog, DiagnosticReportModal } from "../diagnostics/diagnostic-report-dialog";

type ReaderPanel = "layers";

import { useLastTool } from "../reader/use-last-tool";
import { useToolStyle } from "../reader/use-tool-style";

const ReaderEditingControls = lazy(() =>
  import("../reader/reader-editing-controls").then((module) => ({
    default: module.ReaderEditingControls,
  })),
);
const ReaderLayerPanel = lazy(() =>
  import("../reader/reader-layer-panel").then((module) => ({
    default: module.ReaderLayerPanel,
  })),
);
const ReaderPracticeLauncher = lazy(() => import('../playback/reader-practice-launcher').then(module => ({ default: module.ReaderPracticeLauncher })));

export default function ReaderPage() {
  const { choirId, scoreId } = useParams();
  const location = useLocation();
  const identity = useApplicationIdentity();
  return <ReaderPageContent key={`${identity.localUserId ?? "guest"}:${choirId}:${scoreId}:${location.search}`} />;
}

function ReaderPageContent() {
  const t = useMessages("reader");
  const { locale } = useAppLocale();
  const fullscreen = useReaderFullscreen();
  const location = useLocation();
  const navigate = useNavigate();
  const experience = new URLSearchParams(location.search).get("experience") === "1";
  const navigationType = useNavigationType();
  const returnedPanel = navigationType !== "POP" && location.state?.readerReturnPanel === "layers";
  const { choirId = "", scoreId = "" } = useParams();
  const identity = useApplicationIdentity();
  const opening = useReaderWorkspace({ choirId, scoreId, experience, identity });
  const playback = useSyncExternalStore(playbackStore.subscribe, playbackStore.getSnapshot);
  const playbackView = useSyncExternalStore(playbackViewStore.subscribe, playbackViewStore.getSnapshot);
  const practicing = playback?.choirId === choirId && playback.score.id === scoreId;
  const xmlPracticing = practicing && playback.attachment.kind === 'musicxml';
  const comparing = practicing && playbackView === 'compare';
  const showingPlayback = practicing && playbackView === 'xml';
  const workspace = opening.state.status === "ready" ? opening.state.workspace : null;
  const navigation = useAppNavigation();
  const [fitRequest, setFitRequest] = useState(0);
  const [navigationRequest, setNavigationRequest] = useState(0);
  const [zoom, setZoom] = useReturnState("zoom", 1);
  const [editingEditor, setEditingEditor] = useState<AnnotationEditor | null>(null);
  const [annotationInteraction, setAnnotationInteraction] =
    useState<AnnotationOverlayInteraction>("idle");
  const { tool, setTool } = useLastTool(workspace?.ownerKey ?? `user:${identity.localUserId ?? "guest"}`);
  const { style: toolStyle, setStyle: setToolStyle } = useToolStyle(workspace?.ownerKey ?? `user:${identity.localUserId ?? "guest"}`, tool);
  const { color: toolColor, setColor: setToolColor } = useToolColor(workspace?.ownerKey ?? `user:${identity.localUserId ?? "guest"}`, tool);
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null);
  const [chromeVisible, setChromeVisible] = useReturnState("chrome", returnedPanel);
  const [readerPanel, setReaderPanel] = useReturnState<ReaderPanel | null>("panel", returnedPanel ? "layers" : null);
  const [layerPanelTab, setLayerPanelTab] = useState<"display" | "manage">("display");
  const [playbackEntryOpen, setPlaybackEntryOpen] = useState(false);
  useExitLayer(playbackEntryOpen, "overlay", () => { setPlaybackEntryOpen(false); return true; });
  const [moreOpen, setMoreOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [guestNoteOpen, setGuestNoteOpen] = useState(false);
  const guestReadOnly = workspace?.ownerKey.startsWith("guest:") === true;
  const readerBackTrigger = useRef<HTMLButtonElement>(null);
  const focusRevealedTools = useRef(false);
  useEffect(() => {
    if (chromeVisible && focusRevealedTools.current) {
      focusRevealedTools.current = false;
      readerBackTrigger.current?.focus();
    }
  }, [chromeVisible]);
  const moreTrigger = useRef<HTMLButtonElement>(null);
  const layersTrigger = useRef<HTMLButtonElement>(null);
  const previousPanel = useRef(readerPanel);
  useEffect(() => {
    const closedLayers = previousPanel.current === "layers" && readerPanel === null;
    previousPanel.current = readerPanel;
    if (!closedLayers) return;
    const frame = requestAnimationFrame(() => layersTrigger.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [readerPanel]);
  useEffect(() => {
    ensureLoadingJourney("open-score", "direct");
  }, []);
  const { editor, persistence } = useAnnotationEditor(workspace);
  const editing = editor !== null && editor === editingEditor;
  const [exportOpen, setExportOpen] = useState(false);
  const [conflictOpen, setConflictOpen] = useState(false);
  const conflictTrigger = useRef<HTMLButtonElement>(null);
  const previousConflictOpen = useRef(false);
  useEffect(() => {
    const closed = previousConflictOpen.current && !conflictOpen;
    previousConflictOpen.current = conflictOpen;
    if (!closed) return;
    const frame = requestAnimationFrame(() => conflictTrigger.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [conflictOpen]);
  const reader = useReaderSession(workspace, identity.authenticatedUserId, identity.authenticatedSessionId);
  useEffect(() => {
    if (!reader.snapshot.experienceRequired || experience) return;
    void navigation.afterEditing(() => {
      void navigate(readerHref({ choirId, scoreId, experience: true }, location.search), { replace: true, state: location.state });
    });
  }, [reader.snapshot.experienceRequired, experience, navigation, navigate, choirId, scoreId, location.search, location.state]);
  const { score, document, offline: loadedOffline, cloudState, downloading, downloadMessage, preparation } = reader.snapshot;
  const documentScopeKey = document ? workspace?.scopeKey ?? null : null;
  const [inspectionAttempt, setInspectionAttempt] = useState(0);
  const offlineStatus = useOfflineScore(workspace, inspectionAttempt);
  const offline = offlineStatus?.scopeKey === workspace?.scopeKey ? offlineStatus?.record ?? null : loadedOffline;
  const downloadOffline = reader.download;
  useEffect(() => {
    if (document && workspace && documentScopeKey === workspace.scopeKey) {
      recordScoreOpened(driveCacheOwnerKey(workspace.ownerKey.startsWith("user:") ? workspace.ownerKey.slice(5) : null, choirId), choirId, scoreId);
    }
  }, [document, documentScopeKey, workspace, choirId, scoreId, identity.authenticatedUserId]);
  const sync = useReaderSync(workspace, {
    authenticatedUserId: identity.authenticatedUserId,
    sessionId: identity.authenticatedSessionId,
    trashed: cloudState === "trashed",
    confirmIdentity: identity.session.refetch,
  });
  const { annotationState: activeAnnotations, online, localOnly: guestExperience,
    status: syncStatus, syncing, reportOutcome,
    retry: manualSync, refreshConflicts, resolveConflict, lastCheckedAt } = sync;
  const layers = useReadingPreferenceProjection(workspace, [...activeAnnotations?.layers ?? []])
    .map(layer => layer.id === GUEST_NOTE_LAYER_ID ? { ...layer, name: t("previewNotes") } : layer).sort(compareLayers);
  const annotations = activeAnnotations?.annotations ?? [];
  const pendingCount = activeAnnotations?.pendingCount ?? 0;
  const conflicts = activeAnnotations?.conflicts ?? [];
  const editAvailability = reader.snapshot.capability === "ready" && !activeAnnotations?.layersReady
    ? "preparing" : reader.snapshot.capability;
  const { layout, currentPage, setLayout, setCurrentPage } =
    useReaderPreferences({
      pageCount: document?.numPages,
      identity: identity.localUserId ?? "guest",
      choirId,
      scoreId,
    });
  const presentation = useReaderPresentation(reader.presentation, document, currentPage, editing);
  const pager = usePagedReader({
    currentPage,
    pageCount: document?.numPages ?? 1,
    documentKey: `${documentScopeKey ?? "none"}:${score?.currentVersion.id ?? "none"}`,
    enabled: document !== null && layout === "page",
    beforePageChange: editing ? () => editor.prepareNavigation() : undefined,
    canCompletePage: editing ? editor.canNavigate : undefined,
    onPageChange: page => {
      setZoom(1);
      setCurrentPage(page);
    },
  });
  const requestPage = pager.request;

  const guide = useReaderHint("reader-gesture-hint-seen", presentation.status === "visible" && !practicing && !editing && !moreOpen && !playbackEntryOpen && readerPanel === null && !exportOpen && !conflictOpen, null);
  const closeScore = useCallback(() => {
    startLoadingJourney("exit-score", "warm");
    navigation.back(`/choirs/${choirId}`);
  }, [navigation, choirId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        showingPlayback || comparing ||
        (event.target instanceof Element && Boolean(event.target.closest('.practice-dock'))) ||
        (event.target instanceof Element && Boolean(event.target.closest('[role="dialog"]'))) ||
        layout !== "page" ||
        readerPanel !== null || moreOpen || playbackEntryOpen || guide.visible ||
        editing ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        isEditableTarget(event.target)
      ) {
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "PageUp") {
        event.preventDefault();
        requestPage("previous");
      }
      if (event.key === "ArrowRight" || event.key === "PageDown") {
        event.preventDefault();
        requestPage("next");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [editing, layout, moreOpen, playbackEntryOpen, guide.visible, readerPanel, requestPage, setZoom, showingPlayback, comparing]);

  const beginEditing = (pencil = false) => {
    if (cloudState === "trashed") {
      reportOutcome("trash-preserved");
      return;
    }
    if (!workspace) return;
    const preferenceKey = `reader-edit-layer:${workspace.scopeKey}`;
    const rememberedLayerId = readStringPreference(preferenceKey);
    const editableLayer =
      layers.find((layer) => layer.id === rememberedLayerId && layer.canEdit && (!pencil || layer.kind === "personal")) ??
      layers.find((layer) => layer.kind === "personal" && layer.canEdit) ??
      (pencil ? undefined : layers.find((layer) => layer.canEdit));
    if (!editableLayer || !editor?.begin()) return;
    if (pencil || tool === "eraser") setTool("ink");
    setChromeVisible(true);
    setMoreOpen(false);
    setReaderPanel(null);
    setActiveLayerId(editableLayer.id);
    writeStringPreference(preferenceKey, editableLayer.id);
    setEditingEditor(editor);

  };

  const requestEditing = () => {
    if (guestReadOnly) { setGuestNoteOpen(true); return; }
    if (layers.some((layer) => layer.canEdit)) {
      beginEditing();
      return;
    }
    if (editAvailability === "failed") {
      void reader.retryLayers();
      return;
    }
    if (editAvailability === "ready") beginEditing();
  };

  const finishEditing = async () => {
    if (!editor) return false;
    const result = await editor.finish();
    if (result !== "local-saved") { if (result) reportOutcome(result); return false; }
    setEditingEditor(null);
    reportOutcome(result);
    return true;
  };
  useExitLayer(editing, "editing", finishEditing);

  const diagnosticReader: DiagnosticReader = {
    ...(reader.snapshot.opening ? { opening: readerOpeningFacts(reader.snapshot.opening) } : {}),
    interactionMode: editing ? "editing" : "reading",
    pendingCount: activeAnnotations ? Math.min(9999, pendingCount) : null,
    conflictCount: activeAnnotations ? Math.min(9999, conflicts.length) : null,
  };
  const diagnosticDialog = <DiagnosticReportDialog reader={diagnosticReader} />;

  const loadingScreen = <ReaderLoading opening={reader.snapshot.opening} choirId={choirId} fileName={score?.fileName} />;

  if (!workspace) {
    if (opening.state.status !== "failed") return loadingScreen;
    return <main className="page-shell compact-page">
      <h1>{t("cannotOpen")}</h1>
      <p role="alert">{opening.state.message}</p>
      <BackButton className="primary-link" to={`/choirs/${choirId}`}>{t("backToDrive")}</BackButton>
      <Button className="secondary-button" onPress={opening.retry}>{t("retryWorkspace")}</Button>
      <details><summary>{t("moreHelp")}</summary>{diagnosticDialog}</details>
    </main>;
  }

  const displayChoices = <Button className="secondary-button" onPress={() => navigation.afterEditing(reader.retry)}>{t("retryPdfReader")}</Button>;
  const loadError = reader.snapshot.error;
  if (loadError) {
    return (
      <main className="page-shell compact-page">
        <p className="eyebrow">{t("scoreReader")}</p>
        <h1>{t("cannotOpen")}</h1>
        <p className="hero__copy" role="alert">
          {loadError}
        </p>
        {reader.snapshot.opening && <p>{t("loadingStoppedAt", { phase: readerOpeningLabel(reader.snapshot.opening.phase, reader.snapshot.opening.source, locale).replace(/…$/, "") })}</p>}
        <BackButton className="primary-link" to={`/choirs/${choirId}`}>{t("backToDrive")}</BackButton>
        <Button className="secondary-button" onPress={() => navigation.afterEditing(reader.retry)}>{t("retryLoading")}</Button>
        <details><summary>{t("moreHelp")}</summary>{diagnosticDialog}</details>
      </main>
    );
  }

  if (
    reader.snapshot.status !== "ready" ||
    !score ||
    !document ||
    documentScopeKey !== workspace.scopeKey
  ) {
    return loadingScreen;
  }

  const hasNewOfflineVersion =
    offline && offline.versionId !== score.currentVersion.id;
  const goToPage = (page: number) => {
    const target = clamp(page, 1, document.numPages);
    if (layout === "page") requestPage(target);
    else {
      setCurrentPage(target);
      setNavigationRequest(value => value + 1);
    }
  };
  const selectLayout = (value: ReaderLayout) => {
    setZoom(1);
    setLayout(value);
    setMoreOpen(false);
  };
  const toggleChrome = () => {
    if (xmlPracticing) return;
    setPlaybackEntryOpen(false);
    setMoreOpen(false);
    setChromeVisible((visible) => !visible);
  };
  const openReaderPanel = (panel: ReaderPanel) => {
    setMoreOpen(false);
    setLayerPanelTab("display");
    setReaderPanel(panel);
  };
  const selectEditingLayer = (layerId: string) => {
    if (!workspace) return;
    setActiveLayerId(layerId);
    writeStringPreference(`reader-edit-layer:${workspace.scopeKey}`, layerId);
  };
  const canEnterWithPencil = !editing && layout === "page" && !guestReadOnly && !practicing &&
    !moreOpen && !playbackEntryOpen && !readerPanel && !exportOpen && !conflictOpen && !guide.visible &&
    cloudState !== "trashed" && persistence !== "finishing" && layers.some(layer => layer.kind === "personal" && layer.canEdit);
  const annotationPageProps: AnnotationPageProps = {
    layers,
    annotations,
    editing,
    tool,
    toolColor,
    toolStyle,
    onPencilStart: canEnterWithPencil ? () => beginEditing(true) : undefined,
    onTextStyleChange: value => setToolStyle({ ...toolStyle, ...value }),
    activeLayerId,
    onInteractionChange: setAnnotationInteraction,
    editor,
  };

  return (
    <ReaderPresentationContext.Provider value={{ ...presentation.context, retryDocument: () => navigation.afterEditing(reader.retry) }}>
    <main tabIndex={-1} className="reader-shell" data-practicing={xmlPracticing || undefined} data-playback-view={showingPlayback || comparing ? 'xml' : undefined} aria-hidden={showingPlayback || comparing || undefined} inert={showingPlayback || comparing} data-chrome-visible={(chromeVisible && annotationInteraction !== "composing-text") || undefined}>
      <h1 className="visually-hidden">{scoreDisplayName(score.fileName)}</h1>
      {!xmlPracticing && !editing && !chromeVisible && !guide.visible && <Button
        className="reader-reveal-tools visually-hidden"
        onPress={() => { focusRevealedTools.current = true; setChromeVisible(true); }}
      >{t("showReaderTools")}</Button>}
      {editing && annotationInteraction !== "composing-text" && persistence === "failed" && <aside className="reader-alert" role="alert">{t("localSaveFailed")}</aside>}
      {cloudState === "trashed" ? (
        <aside className="reader-alert reader-alert--trash" role="alert">
          {t("trashedOfflineCopyRetained")}
        </aside>
      ) : null}
      {presentation.status === "pending" ? <ReaderLoading opening={reader.snapshot.opening} choirId={choirId} fileName={score.fileName} /> : null}
      {presentation.status === "failed" ? <div className="reader-display-recovery" role="alert">
        <span>{t("pageFailedDraftRetained")}</span>{displayChoices}{diagnosticDialog}
      </div> : null}
      {reader.snapshot.displayMessage && <ReaderDisplayNotice key={reader.snapshot.displayMessage} message={reader.snapshot.displayMessage} onDismiss={reader.dismissDisplayMessage} />}
      {guestNoteOpen && <GuestNoteDialog returnTo={`/choirs/${choirId}/scores/${scoreId}`} onClose={() => setGuestNoteOpen(false)} />}
      {!xmlPracticing && chromeVisible && !guide.visible ? (
      <header className="reader-chrome" data-no-native-selection data-editing={editing || undefined} aria-label={t("readerControls")} style={annotationInteraction === "composing-text" ? { display: "none" } : undefined}>
          {editing && annotationInteraction !== "composing-text" && <p className="reader-edit-gesture-hint">
            <strong>{t("editing")}</strong><span className="reader-edit-gesture-hint__detail">
              <span aria-hidden="true">·</span>{layout === "page" ? t("twoFingerPageSwipe") : t("twoFingerScroll")}
            </span>
          </p>}
          {!editing && <div className="reader-chrome__leading"><Button ref={readerBackTrigger} aria-label={t("backToDrive")} className="reader-chrome__back reader-icon-button" onPress={closeScore}>
            <ArrowLeft aria-hidden="true" size={21} />
          </Button>
          <TooltipTrigger><Button aria-label={t("sharePdf")} className="reader-icon-button reader-chrome__export" onPress={() => setExportOpen(true)}><Share aria-hidden="true" size={21} /></Button><Tooltip className="offline-score-tooltip">{t("sharePdf")}</Tooltip></TooltipTrigger></div>}
          <div className="reader-chrome__actions-stack">
            <div className="reader-chrome__actions">
              <Button
                aria-describedby={editAvailability === "ready" ? undefined : "reader-edit-status"}
                aria-label={editing ? t("finishEditing") : t("edit")}
                aria-description={editing ? t("resumeReadingHint") : t("startEditingHint")}
                className={editing ? "reader-done-button" : "reader-icon-button"}
                data-state={editAvailability}
                isDisabled={
                  editAvailability === "preparing" ||
                  (editAvailability === "read-only" && !guestReadOnly) ||
                  editAvailability === "trashed"
                }
                onPress={() => editing ? navigation.afterEditing(() => { /* Completion is performed by the editing exit layer. */ }) : requestEditing()}
              >
                {editing ? <span>{t("done")}</span> : <Pencil aria-hidden="true" size={21} />}
              </Button>
              {!editing && <><Button
                ref={layersTrigger}
                aria-label={t("noteLayers")}
                aria-expanded={readerPanel === "layers"}
                className="reader-icon-button"
                onPress={() => { if (editing) navigation.afterEditing(() => openReaderPanel("layers")); else openReaderPanel("layers"); }}
              >
                <Layers aria-hidden="true" size={21} />
              </Button>
              <Button
                ref={moreTrigger}
                aria-label={t("more")}
                aria-expanded={moreOpen}
                className="reader-icon-button"
                onPress={() => setMoreOpen((open) => !open)}
              >
                <Ellipsis aria-hidden="true" size={21} />
              </Button></>}
            </div>
            {editAvailability !== "ready" && !(editAvailability === "preparing" && readerPanel !== null) ? (
              <p
                className="reader-edit-status"
                data-state={editAvailability}
                id="reader-edit-status"
                role="status"
              >
                {editAvailability === "preparing"
                  ? t("preparingToEdit")
                  : editAvailability === "failed"
                    ? t("retryEditPreparation")
                    : editAvailability === "read-only"
                      ? <>{t("scoreReadOnly")}{!identity.localUserId && <Link to={loginHref(`/choirs/${choirId}/scores/${scoreId}`)}>{t("signInToAnnotate")}</Link>}</>
                      : t("restoreToEdit")}
              </p>
            ) : null}
          </div>
          {!editing && moreOpen ? (
            <Popover triggerRef={moreTrigger} isOpen={moreOpen} onOpenChange={setMoreOpen} isNonModal placement="bottom end" className="reader-more-popover">
            <Dialog className="reader-more-menu" aria-label={t("moreReaderOptions")} data-no-native-selection>
              <header className="reader-menu-heading"><strong>{t("readerOptions")}</strong><Button className="icon-button" aria-label={t("closeReaderOptions")} onPress={() => setMoreOpen(false)}><X size={20} aria-hidden="true" /></Button></header>
              <IdentityNotice identity={identity} />
              {guestExperience && <section aria-label={t("previewNotes")}><h2>{t("previewNotes")}</h2><p>{t("previewNotesRetention")}</p>
                <Button onPress={() => { if (workspace) void clearGuestNotes(workspace).then(() => reportOutcome("local-saved")).catch(() => reportOutcome("failed")); }}>{t("clearPreviewNotes")}</Button>
              </section>}
              {!editing && <>
              <section aria-label={t("layoutAndZoom")} className="reader-options-display"><div className="reader-option-heading"><h2>{t("readingMode")}</h2>
              {fullscreen.supported && <Button className="reader-option-action" onPress={() => void fullscreen.toggle()}><Maximize size={15} aria-hidden="true" />{fullscreen.active ? t("exitFullScreen") : t("readFullScreen")}</Button>}</div>
              {fullscreen.error && <p role="status">{fullscreen.error}</p>}
              <div className="segmented-control" aria-label={t("pageLayout")}>
                <Button
                  aria-pressed={layout === "page"}
                  onPress={() => selectLayout("page")}
                >
                  <BookOpen aria-hidden="true" size={18} />
                  <span>{t("pageLayoutMode")}</span>
                </Button>
                <Button
                  aria-pressed={layout === "continuous"}
                  onPress={() => selectLayout("continuous")}
                >
                  <Rows3 aria-hidden="true" size={18} />
                  <span>{t("continuousLayoutMode")}</span>
                </Button>
              </div>
              <div className="reader-more-menu__zoom" aria-label={t("zoomControls")}>
                <Button aria-label={t("fitToPage")} onPress={() => { setZoom(1); setFitRequest(value => value + 1); }}>
                  <Maximize2 aria-hidden="true" size={18} />
                  <span>{t("fitToPage")}</span>
                </Button>
                <Button
                  aria-label={t("zoomOut")}
                  onPress={() => setZoom((value) => Math.max(layout === "continuous" ? 0.1 : 1, value - 0.25))}
                >
                  <Minus aria-hidden="true" size={18} />
                </Button>
                <span aria-live="polite">{Math.round(zoom * 100)}%</span>
                <Button
                  aria-label={t("enlarge")}
                  onPress={() => setZoom((value) => Math.min(MAX_READER_ZOOM, value + 0.25))}
                >
                  <Plus aria-hidden="true" size={18} />
                </Button>
              </div>
              </section>
              <section aria-label={t("localOfflineCopy")}><div className="reader-option-heading reader-option-heading--status"><h2><HardDrive size={17} aria-hidden="true" />{t("offlineUse")}</h2>
              <p className="reader-more-menu__status" role="status">
                {offlinePreparationDescription(preparation, offlineStatus ? { record: offline, invalid: offlineStatus.invalid, readFailed: offlineStatus.readFailed } : null, score.currentVersion.id, locale)}
              </p></div>
              {offlineStatus?.readFailed && <Button className="secondary-button" onPress={() => setInspectionAttempt(value => value + 1)}>{t("retryVerification")}</Button>}
              {!offlineStatus?.readFailed && (!offlineStatus || !offline || offlineStatus.invalid || hasNewOfflineVersion || preparation.phase === "failed" || downloading) && (
              <Button
                isDisabled={(preparation.phase === "preparing" && preparation.intent === "explicit") || cloudState === "trashed"}
                onPress={() => void downloadOffline()}
              >
                <HardDrive aria-hidden="true" size={18} />
                {downloading ? preparation.phase === "preparing" && preparation.intent === "automatic" ? t("finishOfflineInBackground") : t("preparingOffline") : preparation.phase === "failed" ? t("retrySaveOffline") : hasNewOfflineVersion ? t("updateOfflineCopy") : t("saveForOffline")}
              </Button>
              )}
              {downloadMessage && preparation.phase === "idle" && <p className="reader-more-menu__status" role="status">{downloadMessage}</p>}
              </section>
              <section aria-label={t("noteSaveAndSync")}>
                <div className="reader-option-heading"><h2><RefreshCw size={17} aria-hidden="true" />{t("noteSync")}</h2>
                {!guestExperience && <Button className="reader-option-action" aria-label={!online ? t("syncWhenOnline") : syncing ? t("syncingShort") : syncStatus.kind === "failed" ? t("retrySynchronization") : t("syncNow")} aria-description={t("syncNotesDescription")} isDisabled={!sync.canRetry} onPress={() => void manualSync()}>{syncing ? t("syncingShort") : syncStatus.kind === "failed" ? t("retry") : t("sync")}</Button>}
                </div>
                {guestExperience ? <p className="reader-more-menu__status" role="status">{syncStatus.message}</p> : <>
                  <dl className="reader-sync-details">
                    <div><dt>{t("localChangesAndUpload")}</dt><dd data-kind={syncStatus.kind} role="status">{syncStatus.message}</dd></div>
                    <div><dt>{t("lastCloudNoteCheck")}</dt><dd>{lastCheckedAt !== null ? new Date(lastCheckedAt).toLocaleString(locale, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) : t("unconfirmed")}</dd></div>
                  </dl>
                  <p className="reader-sync-explanation">{t("syncStatusExplanation")}</p>
                </>}
              </section>
              </>}
              <Link to={experience ? "/appearance?experience=1" : "/appearance"}>{t("appearanceSettings")}</Link>
              <Button className="secondary-button" onPress={() => { setMoreOpen(false); setFeedbackOpen(true); }}>{t("problemFeedback")}</Button>
              <details className="reader-help"><summary>{t("readerHelp")}<ChevronDown size={15} aria-hidden="true" /></summary>
                <Button onPress={() => { setMoreOpen(false); setChromeVisible(false); guide.show(); }}>{t("viewReaderGuide")}</Button>
                {editAvailability === "ready" && <Button onPress={() => { requestEditing(); }}>{t("editGuide")}</Button>}
              </details>
            </Dialog>
            </Popover>
          ) : null}
        </header>
      ) : null}

      {!practicing && !editing && chromeVisible && !guide.visible && (score.musicXmlCount !== undefined ? score.musicXmlCount > 0 : score.attachmentCount === undefined || Boolean(score.attachmentCount)) && workspace && <Suspense fallback={null}>
        <ReaderPracticeLauncher source={{ score, choirId, ownerKey: workspace.ownerKey, sessionId: identity.authenticatedSessionId }} enabled={online && cloudState === 'active'} open={playbackEntryOpen} onOpenChange={setPlaybackEntryOpen} />
      </Suspense>}

      {!editing && (xmlPracticing || chromeVisible) && !guide.visible ? (
        <>
          <PageNavigatorPanel
            compact={xmlPracticing}
            key={score.currentVersion.id}
            document={document}
            currentPage={currentPage}
            onSelect={goToPage}
          />
        </>
      ) : null}

      {editing && editor && annotationInteraction === "idle" ? (
        <Suspense fallback={<p role="status">{t("preparingNoteTools")}</p>}>
          {/* Normal checkpoints and history are serialized by the editor;
              toggling disabled here makes the toolbar flash on every save. */}
          <ReaderEditingControls
            localOnly={guestExperience}
            isDisabled={persistence === "failed"}
            editor={editor}
            layers={layers}
            tool={tool}
            toolColor={toolColor}
            toolStyle={toolStyle}
            onStyleChange={setToolStyle}
            onColorChange={setToolColor}
            activeLayerId={activeLayerId}
            onToolChange={setTool}
            onLayerChange={selectEditingLayer}
            onOpenLayers={tab => { setLayerPanelTab(tab); setReaderPanel("layers"); }}
          />
        </Suspense>
      ) : null}

      {guide.visible && <ReaderGuide layout={layout} onDismiss={guide.dismiss} />}

      {hasNewOfflineVersion ? (
        <aside className="reader-alert" role="status">
          {t("newerOfflineVersionAvailable")}
        </aside>
      ) : null}
      {exportOpen && workspace && <ExportDialog layers={layers} workspace={workspace} source={document} versionId={score.currentVersion.id} fileName={score.fileName} authenticatedUserId={identity.authenticatedUserId} onClose={() => setExportOpen(false)} />}
      {readerPanel === "layers" ? (
        <Suspense fallback={null}>
        {/* Suspend before mounting the focus scope, including on the first open. */}
        <ModalOverlay className="reader-panel-backdrop reader-layers-backdrop" isOpen isDismissable
          onOpenChange={(open) => { if (!open) setReaderPanel(null); }}>
          <Modal className="reader-panel reader-layers-dialog">
            <Dialog preserveOnNavigate aria-label={t("noteLayers")} className="reader-layers-content" data-no-native-selection>
              <header className="reader-panel__header">
                <strong>{t("noteLayers")}</strong>
                <Button autoFocus className="icon-button" aria-label={t("closeLayerDisplay")} onPress={() => setReaderPanel(null)}>
                  <X aria-hidden="true" size={21} />
                </Button>
              </header>
              <ReaderLayerPanel
                key={`${workspace.scopeKey}:${layerPanelTab}`}
                initialTab={layerPanelTab}
                workspace={workspace}
                layers={activeAnnotations?.layers ?? []}
                signedIn={Boolean(identity.authenticatedUserId) && !guestExperience}
              />
            </Dialog>
          </Modal>
        </ModalOverlay>
        </Suspense>
      ) : null}

      {feedbackOpen && <DiagnosticReportModal reader={diagnosticReader} isOpen onOpenChange={setFeedbackOpen} />}
      {!editing && conflicts.length > 0 && !conflictOpen ? (
        <aside className="annotation-conflicts annotation-conflicts--compact" aria-label={t("localNoteConflicts")}>
          <span>{t("compareConflictCount", { count: conflicts.length })}</span>
          <Button ref={conflictTrigger} onPress={() => { setMoreOpen(false); setReaderPanel(null); setConflictOpen(true); }}>{t("view")}</Button>
        </aside>
      ) : null}
      {!editing && conflictOpen && <ReaderConflictDialog key={`${workspace.scopeKey}:${workspace.sessionEpoch}:${score.currentVersion.id}`}
        conflicts={conflicts} document={document} layers={layers} annotations={annotations} online={online}
        onRefresh={refreshConflicts} onResolve={resolveConflict} syncStatus={syncStatus} canRetry={sync.canRetry} onRetry={manualSync} onClose={() => setConflictOpen(false)} />}
      {!editing && (syncStatus.kind === "failed" || syncStatus.kind === "risk") ? (
        <aside className="annotation-conflicts" aria-label={t("noteSyncProblems")}>
          <strong>{syncStatus.message}</strong>
          <div>
            <Button isDisabled={!sync.canRetry} onPress={() => void manualSync()}>
              {t("retrySynchronization")}
            </Button>
            {diagnosticDialog}
          </div>
        </aside>
      ) : null}
      <div className="reader-stage">
        {layout === "page" ? (
          <PageLayout
            document={document}
            currentPage={currentPage}
            zoom={zoom}
            fitRequest={fitRequest}
            onZoomChange={setZoom}
            onToggleChrome={toggleChrome}
            onDismiss={!xmlPracticing && !editing && !moreOpen && !playbackEntryOpen && !readerPanel && !exportOpen && !guide.visible ? closeScore : undefined}
            annotationProps={annotationPageProps}
            pager={pager}
          />
        ) : (
          <ContinuousLayout
            navigationRequest={navigationRequest}
            fitRequest={fitRequest}
            document={document}
            currentPage={currentPage}
            zoom={zoom}
            onZoomChange={setZoom}
            onPageChange={setCurrentPage}
            onToggleChrome={toggleChrome}
            annotationProps={annotationPageProps}

          />
        )}
      </div>
    </main>
    {practicing && playback.attachment.kind === 'musicxml' && <ComparisonPdf
      key={`${playbackStore.getGeneration()}:${score.currentVersion.id}`}
      active={comparing} document={document} initialPage={currentPage} annotationProps={annotationPageProps}
    />}
    </ReaderPresentationContext.Provider>
  );
}

function readStringPreference(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStringPreference(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Editing remains available when persistent preferences are unavailable.
  }
}

function clamp(value: number, minimum: number, maximum: number) {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}

function compareLayers(left: AnnotationLayerSummary, right: AnnotationLayerSummary) {
  if (left.kind !== right.kind) return left.kind === "shared" ? -1 : 1;
  return left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, "zh-CN");
}

function isEditableTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
  );
}
