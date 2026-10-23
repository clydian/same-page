import {
  useEffect,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";
import { Button, Switch } from "react-aria-components";
import type { PlayerSession, PlayerState } from "@same-page/player";
import { setPlaybackView, playbackViewStore, type PlaybackSource } from "./playback-store";
import { NotationZoom } from "./notation-zoom";
import { useNotationPinch } from "./use-notation-pinch";
import { useNotationToolbarClearance } from "./use-notation-toolbar-clearance";
import { PracticePlayerShell } from "./practice-player-shell";
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
        playing={state.playing}
        message={error ?? state.message}
        failed={Boolean(error) || state.status === "error"}
        timeline={{
          value: state.measure,
          min: state.loop?.start ?? 0,
          max: state.loop?.end ?? Math.max(0, state.measures.length - 1),
          loop: Boolean(state.loop),
          disabled: !ready,
          label: (value) => state.measures[value]?.label ?? "准备中",
          seek: (value) => session?.seek(value),
        }}
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
          <h3>声部关注</h3>
          <p className="practice-hint">
            选一个声部，分别调整它和其他声部的音量。
          </p>
          <label className="practice-field">
            关注声部
            <select
              aria-label="关注声部"
              value={typeof state.focus === "number" ? state.focus : ""}
              disabled={!ready}
              onChange={(event) =>
                session?.focus(
                  event.target.value === "" ? null : Number(event.target.value),
                )
              }
            >
              <option value="">各声部独立调节</option>
              {state.parts.map((part) => (
                <option key={part.id} value={part.id}>
                  {part.name}
                </option>
              ))}
            </select>
          </label>
          {typeof state.focus === "number" && (
            <div className="practice-focus-volumes">
              <label className="practice-field">
                关注声部 ·{" "}
                {Math.round(
                  (state.parts.find((part) => part.id === state.focus)
                    ?.volume ?? 0) * 100,
                )}
                %
                <input
                  aria-label="关注声部音量"
                  type="range"
                  min="0"
                  max="1"
                  step=".05"
                  value={
                    state.parts.find((part) => part.id === state.focus)
                      ?.volume ?? 0
                  }
                  onChange={(event) => {
                    if (typeof state.focus === "number")
                      session?.mix(state.focus, {
                        volume: Number(event.target.value),
                      });
                  }}
                />
              </label>
              <label className="practice-field">
                其他声部 · {Math.round((state.otherVolume ?? 0.25) * 100)}%
                <input
                  aria-label="其他声部音量"
                  type="range"
                  min="0"
                  max="1"
                  step=".05"
                  value={state.otherVolume ?? 0.25}
                  onChange={(event) =>
                    session?.focusOther(Number(event.target.value))
                  }
                />
              </label>
              <Button
                className="practice-action"
                onPress={() => session?.focus(null)}
              >
                退出声部关注
              </Button>
            </div>
          )}
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
        <details className="practice-volumes practice-mixer" aria-label="各声部音量">
          <summary>独立混音</summary>
          <p className="practice-hint practice-mixer-legend">
            静音：关闭该声部 · 独奏：只听选中的声部
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
                      : "联动"
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
        </details>
        <LoopRangeEditor session={session} state={state} ready={ready} onPreviewingChange={setLoopPreviewing} onPreview={() => { visual.reset(); if (view === "pdf") setPlaybackView("xml"); }} />
        <section className="practice-notation-options" aria-label="谱面辅助">
          <h3>谱面辅助</h3>
          <Switch
            className="practice-switch"
            isSelected={Boolean(state.solfege)}
            isDisabled={!ready || view === "pdf"}
            onChange={(visible) => session?.solfege(visible)}
          >
            <span className="practice-switch-label">首调数字</span>
            <span className="practice-switch-state" aria-hidden="true">
              {state.solfege ? "开" : "关"}
            </span>
            <span className="practice-switch-track" aria-hidden="true" />
          </Switch>
          {state.solfege && (
            <label className="practice-field">
              标注范围
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
          <p className="practice-hint">
            {view !== "pdf"
              ? "按当前调号，可标注全部或指定声部；不改变播放混音。"
              : "切换到重排谱面后可设置。"}
          </p>
        </section>
        {offlineStatus && <p className="practice-hint" role="status">{offlineStatus === 'ready' ? '此练习谱可离线打开与播放。' : offlineStatus === 'preparing' ? '正在准备离线播放…' : <>离线准备未完成。<Button onPress={retryOffline}>重试离线准备</Button></>}</p>}
        <p className="practice-hint">
          MusicXML 合成播放，不演唱歌词；原 PDF 需手动翻页。
        </p>
      </PracticePlayerShell>
    </>
  );
}
