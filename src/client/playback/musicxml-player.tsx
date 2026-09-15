import { rememberPractice } from "./practice-preferences";
import { holdUpdate } from "../updates/update-safety";
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button } from 'react-aria-components';
import { useNavigate, useLocation } from 'react-router-dom';
import { createPlayerSession, type PlayerSession, type PlayerState } from '@itscly2026/chorus-player';
import { attachmentFetch as diagnosticFetch } from '../score-library/attachments/request';
import { attachmentFileUrl, attachmentPath } from '../score-library/attachments/api';
import { onDriveChange } from '../settings/navigation-events';
import { useAppNavigation, useExitLayer } from '../navigation/navigation-context';
import { stopPlayback, type PlaybackSource } from './playback-store';
import './musicxml-player.css';
const preparing: PlayerState = { status: 'preparing', message: '正在读取附件…', playing: false, parts: [], measures: [], measure: 0, speed: 1, focus: null, loop: null };
const noSubscribe = () => () => {};
const initialSnapshot = () => preparing;
export default function MusicXmlPlayer({ source }: { source: PlaybackSource }) {
  const container = useRef<HTMLDivElement>(null);
  const [session, setSession] = useState<PlayerSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [expanded, setExpanded] = useState(true);
  const [loopStart, setLoopStart] = useState(0);
  const [loopEnd, setLoopEnd] = useState(0);
  const state = useSyncExternalStore(session?.subscribe ?? noSubscribe, session?.getSnapshot ?? initialSnapshot);
  const navigate = useNavigate(), location = useLocation(), navigation = useAppNavigation();
  useExitLayer(expanded, 'overlay', () => { setExpanded(false); return true; });
  useEffect(() => {
    const abort = new AbortController();
    let player: PlayerSession | null = null;
    let releasePreferences = () => {};
    const releaseUpdate = holdUpdate();
    const timeout = setTimeout(() => abort.abort(new Error('读取附件超时。')), 60000);
    const pauseForAudio = (event: Event) => { if (event.target instanceof HTMLMediaElement) player?.pause(); };
    document.addEventListener('play', pauseForAudio, true);
    const release = onDriveChange(impact => { if (impact.driveId === source.choirId && impact.dropAuthority) stopPlayback(); });
    const verify = async () => {
      try {
        const response = await diagnosticFetch(attachmentPath(source.choirId, source.score.id, source.attachment.id), { signal: abort.signal });
        if (!abort.signal.aborted && [401, 403, 404].includes(response.status)) stopPlayback();
      } catch { /* A temporary network failure does not revoke an already loaded file. */ }
    };
    window.addEventListener('focus', verify);
    void (async () => {
      const response = await diagnosticFetch(attachmentFileUrl(source.choirId, source.attachment), { signal: abort.signal });
      if (!response.ok) throw new Error('无法读取附件，请检查网络或访问权限。');
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (abort.signal.aborted || !container.current) return;
      clearTimeout(timeout);
      player = createPlayerSession(container.current, bytes);
      releasePreferences = rememberPractice(player, source);
      setSession(player);
    })().catch(reason => { if (!abort.signal.aborted || abort.signal.reason instanceof Error && abort.signal.reason.name !== 'AbortError') setError(reason instanceof Error ? reason.message : '读取失败。'); });
    return () => { releasePreferences(); releaseUpdate(); abort.abort(); clearTimeout(timeout); release(); document.removeEventListener('play', pauseForAudio, true); window.removeEventListener('focus', verify); player?.dispose(); };
  }, [source, attempt]);
  const play = () => { document.querySelectorAll('audio,video').forEach(element => { if (element instanceof HTMLMediaElement) element.pause(); }); session?.playPause(); };
  const read = () => { setExpanded(false); navigation.afterEditing(() => { void navigate(`/choirs/${source.choirId}/scores/${source.score.id}${location.search}`); }); };
  const ready = state.status === 'ready' && !error;
  return <section className={`musicxml-player${expanded ? '' : ' musicxml-player--compact'}`} aria-label="乐谱练习" data-testid="musicxml-player">
    <header><strong title={source.attachment.name}>{source.attachment.name}</strong>
      <Button onPress={play} isDisabled={!ready}>{state.playing ? '暂停' : '播放'}</Button>
      <Button onPress={() => setExpanded(!expanded)}>{expanded ? '收起详情' : '播放详情'}</Button>
      <Button onPress={stopPlayback} aria-label="结束播放">结束</Button></header>
    {(error || state.message) && <p role="status">{error ?? state.message}</p>}
    {(error || state.status === 'error') && <Button onPress={() => { setError(null); setSession(null); setAttempt(value => value + 1); }}>重试</Button>}
    <div className="musicxml-player__details">
      <div className="musicxml-player__controls">
        <Button onPress={read}>看原谱</Button>
        <label>速度 <select aria-label="速度" value={state.speed} disabled={!ready} onChange={event => session?.speed(Number(event.target.value))}>{[0.5,0.75,1,1.25,1.5].map(speed => <option key={speed} value={speed}>{speed}×</option>)}</select></label>
        <label>关注声部 <select aria-label="关注声部" value={state.focus ?? ""} disabled={!ready} onChange={event => session?.focus(event.target.value === '' ? null : Number(event.target.value))}><option value="" >全部声部</option>{state.focus === "custom" && <option value="custom" disabled>自定义混音</option>}{state.parts.map(part => <option key={part.id} value={part.id}>{part.name}</option>)}</select></label>
      </div>
      <label className="musicxml-player__timeline">{state.measures[state.measure]?.label ?? '准备播放位置'}<input aria-label="播放位置" type="range" min="0" max={Math.max(0,state.measures.length-1)} value={state.measure} disabled={!ready} onChange={event => session?.seek(Number(event.target.value))} /></label>
      <div className="musicxml-player__controls"><label>从 <select aria-label="循环起点" disabled={!ready} value={loopStart} onChange={event => setLoopStart(Number(event.target.value))}>{state.measures.map(m => <option key={m.index} value={m.index}>{m.label}</option>)}</select></label>
        <label>到 <select aria-label="循环终点" disabled={!ready} value={loopEnd} onChange={event => setLoopEnd(Number(event.target.value))}>{state.measures.map(m => <option key={m.index} value={m.index}>{m.label}</option>)}</select></label>
        <Button isDisabled={!ready || loopEnd < loopStart} onPress={() => session?.loop(state.loop ? null : loopStart, loopEnd)}>{state.loop ? '取消循环' : '循环这一段'}</Button></div>
      <details><summary>声部音量与独奏</summary>{state.parts.map(part => <div className="musicxml-player__part" key={part.id}><span>{part.name}</span>
        <input aria-label={`${part.name} 音量`} type="range" min="0" max="1" step="0.05" value={part.volume} disabled={!ready} onChange={event => session?.mix(part.id,{volume:Number(event.target.value)})} />
        <Button isDisabled={!ready} aria-pressed={part.muted} onPress={() => session?.mix(part.id,{muted:!part.muted})}>静音</Button><Button isDisabled={!ready} aria-pressed={part.solo} onPress={() => session?.mix(part.id,{solo:!part.solo})}>独奏</Button></div>)}</details>
      <p className="musicxml-player__hint">合成音色用于音高练习，不会演唱歌词。原 PDF 可手动翻页。</p>
    </div>
    <div className="musicxml-player__notation" aria-label="MusicXML 谱面"><div ref={container} /></div>
  </section>;
}
