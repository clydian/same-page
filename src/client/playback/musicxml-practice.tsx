import {
  useEffect,
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
import { PracticePlayerShell } from "./practice-player-shell";
import { PracticeDisclosure, PracticeSetting, PracticeVolume } from "./practice-setting";
import { LoopRangeEditor } from "./loop-range-editor";
const preparing: PlayerState = {
  status: "preparing",
  message: "正在准备播放…",
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
  error: string | null;
  retry(): void;
  container: RefObject<HTMLDivElement | null>;
  viewport: RefObject<HTMLDivElement | null>;
  embedded?: boolean;
  onReady?(ready: boolean): void;
}) {
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
  useNotationToolbarClearance(viewport, session, !embedded && view !== "pdf");
  const [savedLoop, setSavedLoop] = useState<{ session: PlayerSession | null; range: number[] } | null>(null);
  const [lastFocus, setLastFocus] = useState<{ session: PlayerSession | null; id: number } | null>(null);
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
  const measureLabel = (index: number) => state.measures[index]?.label ?? "—";
  const notationZoom = { scale: state.notationScale, ready, onChange: (value: number) => { visual.reset(); session?.notationScale(value); } };
  return (
    <>
      <section
        className="practice-notation"
        data-visible={view !== "pdf" || undefined}
        data-compare={view === "compare" || undefined}
        aria-label="MusicXML 谱面"
        aria-hidden={view === "pdf"}
        inert={view === "pdf"}
      >
        {view === "compare" && <div className="practice-notation-tools" role="group" aria-label="重排谱面工具"><NotationZoom {...notationZoom} /></div>}
        {view !== "pdf" && <div className="practice-reading-actions">
          {state.following === false && <Button className="practice-follow" onPress={() => { visual.reset(); session?.follow(); }}>恢复自动跟随</Button>}
          {visual.zoom > 1 && <Button className="practice-view-reset" aria-label="恢复查看比例" onPress={visual.reset}>适合宽度</Button>}
        </div>}
        <div
          ref={viewport}
          className="practice-notation-scroll"
          onContextMenu={(event) => event.preventDefault()}
          role="region"
          aria-label="滚动谱面"
          tabIndex={0}
        >
          <div className="practice-notation-extent"><div className="practice-notation-paper">
            <div ref={container} />
          </div></div>
        </div>
      </section>
      <PracticePlayerShell
        source={source}
        loopPreviewing={loopPreviewing}
        embedded={embedded}
        notationZoom={view !== "pdf" && view !== "compare" ? notationZoom : undefined}
        loopStatus={state.loop ? `${measureLabel(state.loop.start)} 至 ${measureLabel(state.loop.end)}` : undefined}
        ready={ready}
        playing={state.playing || Boolean(state.countInBeats)}
        message={error ?? (state.countInBeats ? `预备：${state.countInBeat} / ${state.countInBeats}` : state.message)}
        failed={Boolean(error) || state.status === "error"}
        timeline={{
          value: state.measure,
          min: state.loop?.start ?? 0,
          max: state.loop?.end ?? Math.max(0, state.measures.length - 1),
          disabled: !ready,
          label: (value) => state.measures[value]?.label ?? "准备中",
          seek: (value) => session?.seek(value),
        }}
        tempo={state.tempo}
        speed={state.speed}
        setSpeed={(value) => session?.speed(value)}
        position={
          state.measures[state.measure]
            ? state.measures[state.measure].label.split(" · ")[0].replace(/^第\s*/, "").replace(/\s*小节$/, "")
            : "—"
        }
        previousDisabled={state.measure <= (state.loop?.start ?? 0)}
        nextDisabled={state.measure >= (state.loop?.end ?? state.measures.length - 1)}
        play={play}
        previous={() => session?.seek(state.measure - 1)}
        next={() => session?.seek(state.measure + 1)}
        retry={retry}
      >
        <section className="practice-focus" aria-label="声部关注">
          <PracticeSetting title="声部关注" help="将关注声部和其他声部分别调节。关闭后恢复独立音量；静音和独奏始终保留。" selected={typeof state.focus === 'number'} disabled={!ready || !state.parts.length} onChange={enabled => session?.focus(enabled ? (state.parts.find(part => part.id === (lastFocus?.session === session ? lastFocus?.id : null))?.id ?? state.parts[0]?.id ?? null) : null)} />
          {typeof state.focus === 'number' && <div className="practice-setting-content">
          <label className="practice-field">
            关注声部
            <select
              aria-label="关注声部"
              value={typeof state.focus === "number" ? state.focus : ""}
              disabled={!ready}
              onChange={(event) =>
                { const id = Number(event.target.value); setLastFocus({ session, id }); session?.focus(id); }
              }
            >
              {state.parts.map((part) => (
                <option key={part.id} value={part.id}>
                  {part.name}
                </option>
              ))}
            </select>
          </label>
          <div className="practice-focus-volumes">
            <PracticeVolume title="关注声部" value={state.parts.find(part => part.id === state.focus)?.volume ?? 0} disabled={!ready} onChange={volume => { if (typeof state.focus === 'number') session?.mix(state.focus, { volume }); }} />
            <PracticeVolume title="其他声部" value={state.otherVolume ?? .25} disabled={!ready} onChange={volume => session?.focusOther(volume)} />
          </div>
          </div>}
          {state.parts.some((part) => part.muted || part.solo) && (
            <p className="practice-hint practice-mix-status" role="status">
              {state.parts.some((part) => part.solo)
                ? `独奏中：${state.parts
                    .filter((part) => part.solo)
                    .map((part) => part.name)
                    .join("、")}。`
                : ""}
              {state.parts.some((part) => part.muted)
                ? `已静音：${state.parts
                    .filter((part) => part.muted)
                    .map((part) => part.name)
                    .join("、")}。`
                : ""}
              声部关注保留静音与独奏。
            </p>
          )}
        </section>
        <PracticeDisclosure title="声部混音" help="分别调整各声部音量，静音关闭该声部，独奏只听选中的声部。收起面板不影响声音；声部关注开启时，其他声部音量统一控制。">
          <p className="practice-hint practice-mixer-legend">
            {typeof state.focus === 'number' ? '其他声部音量由“声部关注”统一控制；静音和独奏可独立调整。' : '各声部音量独立调节。'}
          </p>
          {state.parts.map((part) => (
            <div
              className="practice-part"
              key={part.id}
              data-muted={part.muted || undefined}
              data-focus={state.focus === part.id || undefined}
            >
              <span className="practice-part-name" title={part.name}>
                {part.name}
                <small>
                  {typeof state.focus === "number"
                    ? part.id === state.focus
                      ? "关注"
                      : "统一控制"
                    : ""}
                </small>
              </span>
              <div className="practice-part-volume">
                <input
                  aria-label={`${part.name} 音量`}
                  title={
                    typeof state.focus === "number" && state.focus !== part.id
                      ? "由“其他声部”统一调节"
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
                aria-label={`静音 ${part.name}`}
                isDisabled={!ready}
                aria-pressed={part.muted}
                onPress={() => session?.mix(part.id, { muted: !part.muted })}
              >
                静音
              </Button>
              <Button
                className="practice-part-toggle practice-solo"
                aria-label={`独奏 ${part.name}`}
                isDisabled={!ready}
                aria-pressed={part.solo}
                onPress={() => session?.mix(part.id, { solo: !part.solo })}
              >
                独奏
              </Button>
            </div>
          ))}
        </PracticeDisclosure>
        <LoopRangeEditor rememberedRange={savedLoop?.session === session ? savedLoop?.range : null} onRememberRange={range => setSavedLoop({ session, range })} session={session} state={state} ready={ready} onPreviewingChange={setLoopPreviewing} onPreview={() => { visual.reset(); if (view === "pdf") setPlaybackView("xml"); }} />
        <div className="practice-flat-settings">
          <PracticeSetting title="节拍器" help="播放时提供节拍提示，不改变乐谱声部的音量。" selected={Boolean(state.metronome)} disabled={!ready} onChange={metronome => session?.rhythm({ metronome })} />
          <PracticeSetting title="跳转后预备一小节" help="跳转后按目标小节的拍号预备一小节；普通暂停继续和循环衔接不加预备拍。" selected={Boolean(state.countIn)} disabled={!ready} onChange={countIn => session?.rhythm({ countIn })} />

          <PracticeSetting title="首调数字" help="按当前调号标注首调数字，不改变声音或混音。可选择全部声部或指定声部。" selected={Boolean(state.solfege)} disabled={!ready || view === 'pdf'} onChange={visible => session?.solfege(visible)} />
          {state.solfege && (
            <label className="practice-field practice-setting-content">
              <span>标注范围</span>
              <select
                aria-label="标注范围"
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
                <option value="all">全部声部</option>
                {state.parts.map((part) => (
                  <option key={part.id} value={part.id}>
                    仅 {part.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {view === "pdf" && <p className="practice-hint">切换到重排谱面后可设置首调数字。</p>}
        </div>
        {offlineStatus && <p className="practice-hint" role="status">{offlineStatus === 'ready' ? '此练习谱可离线打开与播放。' : offlineStatus === 'preparing' ? '正在准备离线播放…' : <>离线准备未完成。<Button className="practice-inline-action" onPress={retryOffline}>重试离线准备</Button></>}</p>}
        <p className="practice-hint">MusicXML 合成播放，不演唱歌词；原 PDF 需手动翻页。</p>
      </PracticePlayerShell>
    </>
  );
}
