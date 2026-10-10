import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button } from 'react-aria-components';
import { createPlayerSession, type PlayerSession, type PlayerState } from '@clydian/chorus-player';
import { attachmentFetch } from '../score-library/attachments/request';
import { attachmentFileUrl } from '../score-library/attachments/api';
import { playbackViewStore, stopPlayback, type PlaybackSource } from './playback-store';
import { rememberPractice } from './practice-preferences';
import { PracticePlayerShell } from './practice-player-shell';
import { usePlaybackLifetime } from './use-playback-lifetime';
const preparing: PlayerState = { status: 'preparing', message: '正在准备播放…', playing: false, parts: [], measures: [], measure: 0, speed: 1, focus: null, loop: null };
const noSubscribe = () => () => {};
const initialSnapshot = () => preparing;
export default function MusicXmlPlayer({ source }: { source: PlaybackSource }) {
  const container = useRef<HTMLDivElement>(null);
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
      const response = await attachmentFetch(attachmentFileUrl(source.choirId, source.attachment), { signal: abort.signal });
      if (abort.signal.aborted) return;
      if (!response.ok) {
        if ([401, 403, 404].includes(response.status)) { stopPlayback(); return; }
        throw new Error('无法读取附件，请检查网络后重试。');
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (abort.signal.aborted || !container.current) return;
      clearTimeout(timeout);
      player = createPlayerSession(container.current, bytes);
      releasePreferences = rememberPractice(player, source);
      setSession(player);
    })().catch(reason => {
      if (!abort.signal.aborted || abort.signal.reason instanceof Error && abort.signal.reason.name !== 'AbortError') setError(reason instanceof Error ? reason.message : '读取失败。');
    });
    return () => { releasePreferences(); abort.abort(); clearTimeout(timeout); document.removeEventListener('play', pauseForAudio, true); player?.dispose(); };
  }, [source, attempt]);
  const play = () => { document.querySelectorAll('audio,video').forEach(element => { if (element instanceof HTMLMediaElement) element.pause(); }); session?.playPause(); };
  const ready = state.status === 'ready' && !error;
  return <>
    <section className="practice-notation" data-visible={view === 'xml' || undefined} aria-label="MusicXML 谱面" aria-hidden={view !== 'xml'} inert={view !== 'xml'}>
      <div className="practice-notation-heading"><strong>{source.score.fileName}</strong><span>重排谱面 · 来自 MusicXML</span></div>
      <div className="practice-notation-scroll"><div ref={container} /></div>
    </section>
    <PracticePlayerShell source={source} ready={ready} playing={state.playing} message={error ?? state.message} failed={Boolean(error) || state.status === 'error'}
      position={state.measures[state.measure] ? `${state.measure + 1} / ${state.measures.length}` : '—'}
      previousDisabled={state.measure <= 0} nextDisabled={state.measure >= state.measures.length - 1}
      play={play} previous={() => session?.seek(state.measure - 1)} next={() => session?.seek(state.measure + 1)}
      retry={() => { setError(null); setSession(null); setAttempt(value => value + 1); }}>
      <label className="practice-field">播放位置 <span>{state.measures[state.measure]?.label ?? '准备中'}</span><input aria-label="播放位置" type="range" min="0" max={Math.max(0, state.measures.length - 1)} value={state.measure} disabled={!ready} onChange={event => session?.seek(Number(event.target.value))} /></label>
      <div className="practice-fields">
        <label className="practice-field">速度<select aria-label="速度" value={state.speed} disabled={!ready} onChange={event => session?.speed(Number(event.target.value))}>{[0.5, 0.75, 1, 1.25, 1.5].map(speed => <option key={speed} value={speed}>{Math.round(speed * 100)}%</option>)}</select></label>
        <label className="practice-field">关注声部<select aria-label="关注声部" value={state.focus ?? ''} disabled={!ready} onChange={event => session?.focus(event.target.value === '' ? null : Number(event.target.value))}><option value="">全部声部</option>{state.focus === 'custom' && <option value="custom" disabled>自定义混音</option>}{state.parts.map(part => <option key={part.id} value={part.id}>{part.name}</option>)}</select></label>
      </div>
      <details className="practice-mixer"><summary>{state.loop ? '片段循环 · 已开启' : '片段循环'}</summary><div className="practice-fields">
        <label className="practice-field">循环起点<select aria-label="循环起点" disabled={!ready} value={loopStart} onChange={event => setLoopStart(Number(event.target.value))}>{state.measures.map(m => <option key={m.index} value={m.index}>{m.label}</option>)}</select></label>
        <label className="practice-field">循环终点<select aria-label="循环终点" disabled={!ready} value={loopEnd} onChange={event => setLoopEnd(Number(event.target.value))}>{state.measures.map(m => <option key={m.index} value={m.index}>{m.label}</option>)}</select></label>
      </div>
      <Button className="practice-action" isDisabled={!ready || loopEnd < loopStart} aria-pressed={Boolean(state.loop)} onPress={() => session?.loop(state.loop ? null : loopStart, loopEnd)}>{state.loop ? '取消循环' : '循环这一段'}</Button></details>
      <details className="practice-mixer"><summary>声部混音</summary>{state.parts.map(part => <div className="practice-part" key={part.id}><span>{part.name}</span><input aria-label={`${part.name} 音量`} type="range" min="0" max="1" step="0.05" value={part.volume} disabled={!ready} onChange={event => session?.mix(part.id, { volume: Number(event.target.value) })} />
        <Button className="practice-action" isDisabled={!ready} aria-pressed={part.muted} onPress={() => session?.mix(part.id, { muted: !part.muted })}>静音</Button><Button className="practice-action" isDisabled={!ready} aria-pressed={part.solo} onPress={() => session?.mix(part.id, { solo: !part.solo })}>独奏</Button></div>)}</details>
      <p className="practice-hint">声音来自 MusicXML，可能与原谱不同。合成音色不演唱歌词；原 PDF 可手动翻页。</p>
    </PracticePlayerShell>
  </>;
}
