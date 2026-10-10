import { useEffect, useRef, useState } from 'react';
import { attachmentFileUrl } from '../score-library/attachments/api';
import { PracticePlayerShell } from './practice-player-shell';
import { usePlaybackLifetime } from './use-playback-lifetime';
import type { PlaybackSource } from './playback-store';
const time = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
export default function AudioPlayer({ source }: { source: PlaybackSource }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [ready, setReady] = useState(false), [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0), [duration, setDuration] = useState(0), [speed, setSpeed] = useState(1);
  const [error, setError] = useState<string | null>(null), [attempt, setAttempt] = useState(0);
  const [canSeek, setCanSeek] = useState(false), [volume, setVolume] = useState(1);
  usePlaybackLifetime(source);
  useEffect(() => {
    const player = audio.current;
    if (!player) return;
    const pauseForOther = (event: Event) => { if (event.target instanceof HTMLMediaElement && event.target !== player) player.pause(); };
    document.addEventListener('play', pauseForOther, true);
    player.src = attachmentFileUrl(source.choirId, source.attachment); player.load();
    return () => { document.removeEventListener('play', pauseForOther, true); player.pause(); player.removeAttribute('src'); player.load(); };
  }, [source, attempt]);
  const seekable = ready && duration > 0 && canSeek;
  const seek = (next: number) => { if (seekable && audio.current) audio.current.currentTime = Math.max(0, Math.min(duration, next)); };
  const play = () => {
    const player = audio.current;
    if (!player) return;
    if (!player.paused) player.pause();
    else { document.querySelectorAll('audio,video').forEach(other => { if (other !== player && other instanceof HTMLMediaElement) other.pause(); }); void player.play().catch(() => setError('暂时无法开始播放，请重试或下载音频。')); }
  };
  return <>
    <audio ref={audio} preload="metadata" onLoadedMetadata={() => { const player = audio.current; const value = player?.duration ?? 0; setDuration(Number.isFinite(value) ? value : 0); setCanSeek(Boolean(player?.seekable.length)); if (player) { player.playbackRate = speed; player.volume = volume; } setReady(true); }}
      onProgress={() => { const player = audio.current; const value = player?.duration ?? 0; if (Number.isFinite(value)) setDuration(value); setCanSeek(Boolean(player?.seekable.length)); }}
      onTimeUpdate={() => setPosition(audio.current?.currentTime ?? 0)} onPlay={() => { setError(null); setPlaying(true); }} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
      onError={() => { setReady(false); setError('音频暂不可用，请检查网络或从附件菜单下载。'); }} />
    <PracticePlayerShell source={source} ready={ready} playing={playing} message={error ?? (!ready ? '正在准备音频…' : '')} failed={Boolean(error)}
      position={`${time(position)} / ${time(duration)}`} previousDisabled={!seekable || position <= 0} nextDisabled={!seekable || position >= duration}
      play={play} previous={() => seek(position - 10)} next={() => seek(position + 10)} retry={() => { setError(null); setReady(false); setAttempt(value => value + 1); }}>
      <label className="practice-field">播放位置 <span>{time(position)} / {time(duration)}</span><input aria-label="播放位置" type="range" min="0" max={duration} value={position} step="0.1" disabled={!seekable} onChange={event => seek(Number(event.target.value))} /></label>
      <div className="practice-fields"><label className="practice-field">速度<select aria-label="速度" value={speed} disabled={!ready} onChange={event => { const value = Number(event.target.value); if (audio.current) audio.current.playbackRate = value; setSpeed(value); }}>{[0.5, 0.75, 1, 1.25, 1.5].map(value => <option key={value} value={value}>{Math.round(value * 100)}%</option>)}</select></label>
      <label className="practice-field">音量<input aria-label="音量" type="range" min="0" max="1" step="0.05" value={volume} onChange={event => { const value = Number(event.target.value); if (audio.current) audio.current.volume = value; setVolume(value); }} /></label></div>
      <p className="practice-hint">原 PDF 可手动翻页。音频附件需联网打开，不包含在主谱离线副本中。</p>
    </PracticePlayerShell>
  </>;
}
