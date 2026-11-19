import { useAppLocale, useMessages } from "../../i18n";
import { readAppearance, saveAppearance } from "../appearance/appearance-store";
import { useAppearance } from "../appearance/appearance-context";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";
import { Button } from "react-aria-components";
import type { PlayerSession, PlayerState } from "@same-page/player";
import { setPlaybackView, playbackViewStore, type PlaybackSource } from "./playback-store";
import { NotationZoom } from "./notation-zoom";
import { useNotationPinch } from "./use-notation-pinch";
import { useNotationToolbarClearance } from "./use-notation-toolbar-clearance";
import type { PlaybackPreparationProgress } from './playback-preparation-notice';
import { PracticePlayerShell } from "./practice-player-shell";
import { usePracticeFocus } from "./use-practice-focus";
import { PracticeDisclosure, PracticeSetting, PracticeVolume } from "./practice-setting";
import { LyricSizeControl } from "./lyric-size-control";
import { LoopRangeEditor } from "./loop-range-editor";
import { PlaybackAudioHint } from './playback-audio-hint';
import { useMeasureLabel } from "./measure-label";
const preparing: PlayerState = {
  status: "preparing",
  message: "",
  playing: false,
  parts: [],
  measures: [],
  measure: 0,
  speed: 1,
  notationScale: 0.6,
  focus: null,
  loop: null,
};
const noSubscribe = () => () => {};
const initialSnapshot = () => preparing;
// Both the reader and the product review page use this exact notation/control UI.
// Source authorization, fetching, cache ownership and disposal remain with callers.
export function MusicXmlPractice({
  source,
  offlineStatus,
  retryOffline,
  session,
  preparation,
  error,
  retry,
  container,
  viewport,
  embedded = false,
  onReady,
}: {
  source?: PlaybackSource;
  offlineStatus?: "preparing" | "ready" | "failed";
  retryOffline?(): void;
  session: PlayerSession | null;
  preparation?: PlaybackPreparationProgress;
  error: string | null;
  retry(): void;
  container: RefObject<HTMLDivElement | null>;
  viewport: RefObject<HTMLDivElement | null>;
  embedded?: boolean;
  onReady?(ready: boolean): void;
}) {
  const focus = usePracticeFocus(embedded);
  const t = useMessages("practice");
  const { preferences, owner, dark } = useAppearance();
  const lyricSize = preferences.lyricSize ?? 16;
  const [lyricSaveFailed, setLyricSaveFailed] = useState(false);
  const systemMessages = useMessages("system");
  const { locale } = useAppLocale();
  const paper = dark ? preferences.darkPaper : preferences.lightPaper;
  useEffect(() => { session?.notationTheme?.(paper === "inverted" ? "inverted" : "original"); }, [session, paper]);
  const state = useSyncExternalStore(
    session?.subscribe ?? noSubscribe,
    session?.getSnapshot ?? initialSnapshot,
  );
  const readerView = useSyncExternalStore(
    playbackViewStore.subscribe,
    playbackViewStore.getSnapshot,
  );
  const view = embedded ? "xml" : readerView;
  const visual = useNotationPinch(viewport, session, view !== "pdf" && !error);
  useNotationToolbarClearance(viewport, session, !embedded && view !== "pdf", view);
  const [savedLoop, setSavedLoop] = useState<{ session: PlayerSession | null; range: number[] } | null>(null);
  const [lastFocus, setLastFocus] = useState<{ session: PlayerSession | null; id: number } | null>(null);
  const scrubFromPdf = useRef(false);
  const [loopPreviewing, setLoopPreviewing] = useState(false);
  useEffect(() => {
    onReady?.(state.status === "ready" && !error);
  }, [state.status, error, onReady]);
  const play = () => {
    document.querySelectorAll("audio,video").forEach((element) => {
      if (element instanceof HTMLMediaElement) element.pause();
    });
    session?.playPause();
  };
  const ready = state.status === "ready" && !error;
  useEffect(() => { if (ready) session?.lyricSize?.(lyricSize); }, [session, ready, lyricSize]);
  const formatMeasure = useMeasureLabel();
  const measureLabel = (index: number) => formatMeasure(state.measures[index], "—");
  const partName = (part: PlayerState["parts"][number]) => part.unnamed === undefined ? part.name : t("unnamedPart", { index: part.unnamed });
  const namesFor = (flag: "solo" | "muted") => new Intl.ListFormat(locale, { style: "narrow" })
    .format(state.parts.filter(part => part[flag]).map(partName));
  const notationZoom = { scale: state.notationScale, ready, onChange: (value: number) => { visual.reset(); session?.notationScale(value); } };
  return (
    <>
      <section
        className="practice-notation"
        data-visible={view !== "pdf" || undefined}
        data-compare={view === "compare" || undefined}
        data-controls-collapsed={focus.toolsCollapsed || undefined}
        aria-label={t("musicXmlScore")}
        aria-hidden={view === "pdf"}
        inert={view === "pdf"}
      >
        {view === "compare" && <div id="practice-notation-tools" className="practice-notation-tools" hidden={focus.toolsCollapsed} role="group" aria-label={t("reflowTools")}><NotationZoom {...notationZoom} /></div>}
        {view !== "pdf" && <div className="practice-reading-actions">
          {state.following === false && <Button className="practice-follow" onPress={() => { visual.reset(); session?.follow(); }}>{t("resumeFollowing")}</Button>}
          {visual.zoom > 1 && <Button className="practice-view-reset" aria-label={t("resetViewZoom")} onPress={visual.reset}>{t("fitToWidth")}</Button>}
        </div>}
        <div
          ref={viewport}
          className="practice-notation-scroll"
          onContextMenu={(event) => event.preventDefault()}
          role="region"
          aria-label={t("scrollScore")}
          tabIndex={0}
        >
          <div className="practice-notation-extent"><div className="practice-notation-paper">
            <div ref={container} />
          </div></div>
        </div>
      </section>
      <PracticePlayerShell
        focus={focus}
        source={source}
        loopPreviewing={loopPreviewing}
        embedded={embedded}
        notationZoom={view !== "pdf" && view !== "compare" ? notationZoom : undefined}
        loopStatus={state.loop ? t("measureRange", { start: measureLabel(state.loop.start), end: measureLabel(state.loop.end) }) : undefined}
        ready={ready}
        playing={state.playing || Boolean(state.countInBeats)}
        preparation={session ? state.loadingProgress : preparation && preparation.loaded !== undefined && preparation.total !== undefined ? { loaded: preparation.loaded, total: preparation.total } : undefined}
        message={error ?? (!session && preparation ? preparation.message : state.countInBeats ? t("countInProgress", { beat: state.countInBeat ?? 0, total: state.countInBeats }) : state.messageCode ? t(state.messageCode) : session ? state.message : t("playbackPreparing"))}
        hint={ready && <PlaybackAudioHint session={session} message={state.audioHint ? t("audioHint") : undefined} />}
        failed={Boolean(error) || state.status === "error"}
        timeline={{
          value: state.measure,
          min: state.loop?.start ?? 0,
          max: state.loop?.end ?? Math.max(0, state.measures.length - 1),
          disabled: !ready,
          label: (value) => formatMeasure(state.measures[value], t("preparing")),
          seek: (value) => { scrubFromPdf.current = false; session?.seek(value); },
          preview: (value) => {
            if (value !== null && view === "pdf") { scrubFromPdf.current = true; setPlaybackView("xml"); }
            session?.previewMeasure(value);
            if (value === null && scrubFromPdf.current) { scrubFromPdf.current = false; setPlaybackView("pdf"); }
          },
        }}
        tempo={state.tempo}
        speed={state.speed}
        setSpeed={(value) => session?.speed(value)}
        position={
          state.measures[state.measure]
            ? state.measures[state.measure].number ?? state.measures[state.measure].label.split(" · ")[0].replace(/^第\s*/, "").replace(/\s*小节$/, "")
            : "—"
        }
        previousDisabled={state.measure <= (state.loop?.start ?? 0)}
        nextDisabled={state.measure >= (state.loop?.end ?? state.measures.length - 1)}
        play={play}
        previous={() => session?.seek(state.measure - 1)}
        next={() => session?.seek(state.measure + 1)}
        retry={retry}
      >
        <PracticeDisclosure title={t("partMixer")} help={t("partMixerHelp")} summary={typeof state.focus === "number" ? partName(state.parts.find(part => part.id === state.focus)!) : undefined}>
        <section className="practice-focus" aria-label={t("partFocus")}>
          <PracticeSetting title={t("partFocus")} help={t("partFocusHelp")} selected={typeof state.focus === 'number'} disabled={!ready || !state.parts.length} onChange={enabled => session?.focus(enabled ? (state.parts.find(part => part.id === (lastFocus?.session === session ? lastFocus?.id : null))?.id ?? state.parts[0]?.id ?? null) : null)} />
          {typeof state.focus === 'number' && <div className="practice-focus-content">
          <label className="practice-field">
            {t("focusedPart")}
            <select
              aria-label={t("focusedPart")}
              value={typeof state.focus === "number" ? state.focus : ""}
              disabled={!ready}
              onChange={(event) =>
                { const id = Number(event.target.value); setLastFocus({ session, id }); session?.focus(id); }
              }
            >
              {state.parts.map((part) => (
                <option key={part.id} value={part.id}>
                  {partName(part)}
                </option>
              ))}
            </select>
          </label>
          <div className="practice-focus-volumes">
            <PracticeVolume title={t("focusedPart")} value={state.parts.find(part => part.id === state.focus)?.volume ?? 0} disabled={!ready} onChange={volume => { if (typeof state.focus === 'number') session?.mix(state.focus, { volume }); }} />
            <PracticeVolume title={t("otherParts")} value={state.otherVolume ?? .25} disabled={!ready} onChange={volume => session?.focusOther(volume)} />
          </div>
          </div>}
          {state.parts.some((part) => part.muted || part.solo) && (
            <p className="practice-hint practice-mix-status" role="status">
              {state.parts.some((part) => part.solo)
                ? t("soloingParts", { parts: namesFor("solo") })
                : ""}
              {state.parts.some((part) => part.muted)
                ? t("mutedParts", { parts: namesFor("muted") })
                : ""}
              {t("focusKeepsMix")}
            </p>
          )}
        </section>
          <p className="practice-hint practice-mixer-legend">
            {typeof state.focus === 'number' ? t("partMixerFocused") : t("partMixerIndependent")}
          </p>
          {state.parts.map((part) => (
            <div
              className="practice-part"
              key={part.id}
              data-muted={part.muted || undefined}
              data-focus={state.focus === part.id || undefined}
            >
              <span className="practice-part-name" title={partName(part)}>
                {partName(part)}
                <small>
                  {typeof state.focus === "number"
                    ? part.id === state.focus
                      ? t("focused")
                      : t("jointControl")
                    : ""}
                </small>
              </span>
              <div className="practice-part-volume">
                <input
                  aria-label={t("partVolume", { part: partName(part) })}
                  title={
                    typeof state.focus === "number" && state.focus !== part.id
                      ? t("controlledByOtherParts")
                      : undefined
                  }
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={part.volume}
                  disabled={
                    !ready ||
                    (typeof state.focus === "number" && state.focus !== part.id)
                  }
                  onChange={(event) =>
                    session?.mix(part.id, {
                      volume: Number(event.target.value),
                    })
                  }
                />
                <output>{Math.round(part.volume * 100)}%</output>
              </div>
              <Button
                className="practice-part-toggle practice-mute"
                aria-label={t("mutePart", { part: partName(part) })}
                isDisabled={!ready}
                aria-pressed={part.muted}
                onPress={() => session?.mix(part.id, { muted: !part.muted })}
              >
                {t("mute")}
              </Button>
              <Button
                className="practice-part-toggle practice-solo"
                aria-label={t("soloPart", { part: partName(part) })}
                isDisabled={!ready}
                aria-pressed={part.solo}
                onPress={() => session?.mix(part.id, { solo: !part.solo })}
              >
                {t("solo")}
              </Button>
            </div>
          ))}
        </PracticeDisclosure>
        <LoopRangeEditor rememberedRange={savedLoop?.session === session ? savedLoop?.range : null} onRememberRange={range => setSavedLoop({ session, range })} session={session} state={state} ready={ready} onPreviewingChange={setLoopPreviewing} onPreview={() => { visual.reset(); if (view === "pdf") setPlaybackView("xml"); }} />
        <div className="practice-flat-settings">
          <PracticeSetting title={t("scaleDegrees")} help={t("scaleDegreesHelp")} selected={Boolean(state.solfege)} disabled={!ready || view === 'pdf'} onChange={visible => session?.solfege(visible)} />
          {state.solfege && (
            <label className="practice-field practice-inline-field">
              <span>{t("annotationRange")}</span>
              <select
                aria-label={t("annotationRange")}
                value={
                  state.solfegePart === null ? "all" : (state.solfegePart ?? 0)
                }
                disabled={!ready || view === "pdf"}
                onChange={(event) =>
                  session?.solfege(
                    true,
                    event.target.value === "all"
                      ? null
                      : Number(event.target.value),
                  )
                }
              >
                <option value="all">{t("allParts")}</option>
                {state.parts.map((part) => (
                  <option key={part.id} value={part.id}>
                    {t("onlyPart", { part: partName(part) })}
                  </option>
                ))}
              </select>
            </label>
          )}
          {view === "pdf" && <p className="practice-hint">{t("scaleDegreesReflowHint")}</p>}
        </div>
        {offlineStatus && <p className="practice-hint" role="status">{offlineStatus === 'ready' ? t("offlineReady") : offlineStatus === 'preparing' ? t("offlinePreparing") : <>{t("offlineIncomplete")}<Button className="practice-inline-action" onPress={retryOffline}>{t("retryOffline")}</Button></>}</p>}
        {state.audioHint && <p className="practice-hint">{t("audioHint")}</p>}
        <PracticeDisclosure title={t("advancedSettings")}>
          <PracticeSetting title={t("metronome")} help={t("metronomeHelp")} selected={Boolean(state.metronome)} disabled={!ready} onChange={metronome => session?.rhythm({ metronome })} />
          <PracticeSetting title={t("countInAfterSeek")} help={t("countInHelp")} selected={Boolean(state.countIn)} disabled={!ready} onChange={countIn => session?.rhythm({ countIn })} />

          <LyricSizeControl key={owner} value={lyricSize} disabled={!ready || view === 'pdf'} onChange={size => {
            session?.lyricSize?.(size);
            setLyricSaveFailed(!saveAppearance(owner, { ...readAppearance(owner), lyricSize: size }));
          }} />
          {lyricSaveFailed && <p className="practice-hint" role="status">{systemMessages("appearance.unsaved")}</p>}
        </PracticeDisclosure>
      </PracticePlayerShell>
    </>
  );
}
