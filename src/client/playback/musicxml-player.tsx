import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button } from 'react-aria-components';
import { createPlayerSession, type PlayerSession, type PlayerState } from '@clydian/chorus-player';
import { attachmentFetch } from '../score-library/attachments/request';
import { readAttachment, attachmentFileUrl } from '../score-library/attachments/api';
import { playbackViewStore, stopPlayback, type PlaybackSource } from './playback-store';
import { SettingsRequestError } from '../settings/settings-request';
import { rememberPractice } from './practice-preferences';
import { PracticePlayerShell } from './practice-player-shell';
import { clearPlaybackPreparation, readPlaybackPreparation, savePlaybackPreparation } from './playback-preparation';
import { usePlaybackLifetime } from './use-playback-lifetime';
const preparing: PlayerState = { status: 'preparing', message: '正在准备播放…', playing: false, parts: [], measures: [], measure: 0, speed: 1, focus: null, loop: null };
const noSubscribe = () => () => {};
const initialSnapshot = () => preparing;
export default function MusicXmlPlayer({ source }: { source: PlaybackSource }) {
  const container = useRef<HTMLDivElement>(null), viewport = useRef<HTMLDivElement>(null);
  const [session, setSession] = useState<PlayerSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [loopStart, setLoopStart] = useState(0), [loopEnd, setLoopEnd] = useState(0);
  const state = useSyncExternalStore(session?.subscribe ?? noSubscribe, session?.getSnapshot ?? initialSnapshot);
  const view = useSyncExternalStore(playbackViewStore.subscribe, playbackViewStore.getSnapshot);
  usePlaybackLifetime(source);
  useEffect(() => {
    const abort = new AbortController();
    let player: PlayerSession | null = null, releasePreferences = () => {};
    const timeout = setTimeout(() => abort.abort(new Error('读取附件超时，请重试。')), 60000);
    const pauseForAudio = (event: Event) => { if (event.target instanceof HTMLMediaElement) player?.pause(); };
    document.addEventListener('play', pauseForAudio, true);
    void (async () => {
      const fresh = await readAttachment(source.choirId, source.score.id, source.attachment.id, abort.signal);
      if (abort.signal.aborted) return;
      if (fresh.revision !== source.attachment.revision) throw new Error('附件已更新，请从附件列表重新打开。');
      const cached = readPlaybackPreparation(source);
      let bytes = cached?.bytes;
      if (!bytes) {
        const response = await attachmentFetch(attachmentFileUrl(source.choirId, source.attachment), { signal: abort.signal });
        if (abort.signal.aborted) return;
        if (!response.ok) {
          if ([401, 403, 404].includes(response.status)) { stopPlayback(); return; }
          throw new Error('无法读取附件，请检查网络后重试。');
        }
        bytes = new Uint8Array(await response.arrayBuffer());
      }
      if (abort.signal.aborted || !container.current) return;
      clearTimeout(timeout);
      const sourceBytes = bytes;
      player = createPlayerSession(container.current, sourceBytes, { scrollElement: viewport.current ?? undefined, prepared: cached?.prepared,
        onPrepared: prepared => { if (!abort.signal.aborted) savePlaybackPreparation(source, sourceBytes, prepared); } });
      releasePreferences = rememberPractice(player, source);
      setSession(player);
    })().catch(reason => {
      if (!abort.signal.aborted && reason instanceof SettingsRequestError && [401,403,404].includes(reason.status)) { clearPlaybackPreparation(source); stopPlayback(); return; }
      if (!abort.signal.aborted || abort.signal.reason instanceof Error && abort.signal.reason.name !== 'AbortError') setError(reason instanceof Error ? reason.message : '读取失败。');
    });
    return () => { releasePreferences(); abort.abort(); clearTimeout(timeout); document.removeEventListener('play', pauseForAudio, true); player?.dispose(); };
  }, [source, attempt]);
  const play = () => { document.querySelectorAll('audio,video').forEach(element => { if (element instanceof HTMLMediaElement) element.pause(); }); session?.playPause(); };
  const ready = state.status === 'ready' && !error;
  return <>
    <section className="practice-notation" data-visible={view === 'xml' || undefined} aria-label="MusicXML 谱面" aria-hidden={view !== 'xml'} inert={view !== 'xml'}>
      {view === 'xml' && <Button className="practice-action practice-degree-toggle" isDisabled={!ready} aria-pressed={Boolean(state.solfege)} onPress={() => session?.solfege(!state.solfege)}><span aria-hidden="true">1·2·3</span> 首调数字</Button>}
      {state.following === false && <Button className="practice-follow" onPress={() => session?.follow()}>恢复自动跟随</Button>}
      <div ref={viewport} className="practice-notation-scroll" role="region" aria-label="滚动谱面" tabIndex={0}><div className="practice-notation-paper"><div ref={container} /></div></div>
    </section>
    <PracticePlayerShell source={source} ready={ready} playing={state.playing} message={error ?? state.message} failed={Boolean(error) || state.status === 'error'}
      timeline={{value:state.measure,max:Math.max(0,state.measures.length-1),disabled:!ready,label:value => state.measures[value]?.label ?? '准备中',seek:value => session?.seek(value)}}
      speed={state.speed} setSpeed={value => session?.speed(value)}
      position={state.measures[state.measure] ? `${state.measures[state.measure].label.split(" · ")[0]}${state.loop ? " · 循环" : ""}` : '—'}
      previousDisabled={state.measure <= 0} nextDisabled={state.measure >= state.measures.length - 1}
      play={play} previous={() => session?.seek(state.measure - 1)} next={() => session?.seek(state.measure + 1)}
      retry={() => { setError(null); setSession(null); setAttempt(value => value + 1); }}>
      <section className="practice-focus" aria-label="声部关注"><h3>声部关注</h3>
        <p className="practice-hint">选一个声部，分别调整它和其他声部的音量。</p>
        <label className="practice-field">关注声部<select aria-label="关注声部" value={typeof state.focus === 'number' ? state.focus : ''} disabled={!ready} onChange={event => session?.focus(event.target.value === '' ? null : Number(event.target.value))}><option value="">各声部独立调节</option>{state.parts.map(part => <option key={part.id} value={part.id}>{part.name}</option>)}</select></label>
        {typeof state.focus === 'number' && <div className="practice-focus-volumes">
          <label className="practice-field">关注声部 · {Math.round((state.parts.find(part => part.id === state.focus)?.volume ?? 0)*100)}%<input aria-label="关注声部音量" type="range" min="0" max="1" step=".05" value={state.parts.find(part => part.id === state.focus)?.volume ?? 0} onChange={event => { if (typeof state.focus === 'number') session?.mix(state.focus, {volume:Number(event.target.value)}); }} /></label>
          <label className="practice-field">其他声部 · {Math.round((state.otherVolume ?? .25)*100)}%<input aria-label="其他声部音量" type="range" min="0" max="1" step=".05" value={state.otherVolume ?? .25} onChange={event => session?.focusOther(Number(event.target.value))} /></label>
          <Button className="practice-action" onPress={() => session?.focus(null)}>退出声部关注</Button>
        </div>}
        {(state.parts.some(part => part.muted || part.solo)) && <p className="practice-hint practice-mix-status" role="status">{state.parts.some(part => part.solo) ? `独奏中：${state.parts.filter(part => part.solo).map(part => part.name).join('、')}。` : ''}{state.parts.some(part => part.muted) ? `已静音：${state.parts.filter(part => part.muted).map(part => part.name).join('、')}。` : ''}声部关注保留静音与独奏。</p>}
      </section>
      <section className="practice-volumes" aria-label="各声部音量"><h3>各声部音量</h3>
      <p className="practice-hint practice-mixer-legend">静音：关闭该声部 · 独奏：只听选中的声部</p>
      {state.parts.map(part => <div className="practice-part" key={part.id} data-muted={part.muted || undefined} data-focus={state.focus === part.id || undefined}>
        <span className="practice-part-name" title={part.name}>{part.name}<small>{typeof state.focus === 'number' ? part.id === state.focus ? '关注' : '联动' : ''}</small></span>
        <div className="practice-part-volume"><input aria-label={`${part.name} 音量`} title={typeof state.focus === 'number' && state.focus !== part.id ? '由“其他声部”统一调节' : undefined} type="range" min="0" max="1" step="0.05" value={part.volume} disabled={!ready || typeof state.focus === 'number' && state.focus !== part.id} onChange={event => session?.mix(part.id, { volume: Number(event.target.value) })} /><output>{Math.round(part.volume * 100)}%</output></div>
        <Button className="practice-part-toggle practice-mute" aria-label={`静音 ${part.name}`} isDisabled={!ready} aria-pressed={part.muted} onPress={() => session?.mix(part.id, { muted: !part.muted })}>静音</Button>
        <Button className="practice-part-toggle practice-solo" aria-label={`独奏 ${part.name}`} isDisabled={!ready} aria-pressed={part.solo} onPress={() => session?.mix(part.id, { solo: !part.solo })}>独奏</Button>
      </div>)}
      </section>
      <details className="practice-mixer"><summary>{state.loop ? '片段循环 · 已开启' : '片段循环'}</summary><div className="practice-fields">
        <label className="practice-field">循环起点<select aria-label="循环起点" disabled={!ready} value={loopStart} onChange={event => setLoopStart(Number(event.target.value))}>{state.measures.map(m => <option key={m.index} value={m.index}>{m.label}</option>)}</select></label>
        <label className="practice-field">循环终点<select aria-label="循环终点" disabled={!ready} value={loopEnd} onChange={event => setLoopEnd(Number(event.target.value))}>{state.measures.map(m => <option key={m.index} value={m.index}>{m.label}</option>)}</select></label>
      </div>
      <Button className="practice-action" isDisabled={!ready || loopEnd < loopStart} aria-pressed={Boolean(state.loop)} onPress={() => session?.loop(state.loop ? null : loopStart, loopEnd)}>{state.loop ? '取消循环' : '循环这一段'}</Button></details>
      <p className="practice-hint">声音来自 MusicXML，可能与原谱不同。合成音色不演唱歌词；原 PDF 可手动翻页。</p>
    </PracticePlayerShell>
  </>;
}
