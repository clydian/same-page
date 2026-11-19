import { useMessages } from "../../i18n";
import { readerHref } from "../reader/reader-entry";
import { useEffect, useRef, useState, useSyncExternalStore, type ComponentProps } from 'react';
import { connections, connectionsEnabled, connectionUrl } from '../connection/connection';
import { attachmentFileUrl } from '../score-library/attachments/api';
import { PracticePlayerShell } from './practice-player-shell';
import { usePracticeFocus } from './use-practice-focus';
import { usePlaybackLifetime } from './use-playback-lifetime';
import { playbackStore, stopPlayback, type PlaybackSource } from './playback-store';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from 'react-aria-components';
import { FileAudio, Pause, Play } from 'lucide-react';
import { AttachmentShell } from '../score-library/attachments/attachment-shell';
import { scoreDisplayName } from '../../shared/score-display-name';
import { useAppNavigation } from '../navigation/navigation-context';
const time = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
export default function AudioPlayer({ source }: { source: PlaybackSource }) {
  const t = useMessages("practice");
  const location = useLocation(), navigate = useNavigate(), navigation = useAppNavigation();
  const preview = location.pathname === `/choirs/${source.choirId}`;
  const showScore = () => navigation.afterEditing(() => {
    if (playbackStore.getSnapshot() === source) void navigate(readerHref({ choirId: source.choirId, scoreId: source.score.id, experience: source.experience === true || source.ownerKey.startsWith("experience:") }, location.search));
  });
  const audio = useRef<HTMLAudioElement>(null);
  const connection = useSyncExternalStore(connections.subscribe, connections.getSnapshot);
  const route = connection.active, entryReady = connection.identity[route];
  const resume = useRef<{ source: PlaybackSource; time: number; playing: boolean; speed: number } | null>(null);
  const recoveredAutomatically = useRef(false);
  const [ready, setReady] = useState(false), [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0), [duration, setDuration] = useState(0), [speed, setSpeed] = useState(1);
  const [error, setError] = useState<"audioCouldNotPlay" | "audioClickToResume" | "audioUnavailable" | null>(null), [attempt, setAttempt] = useState(0);
  const [canSeek, setCanSeek] = useState(false);
  usePlaybackLifetime(source);
  useEffect(() => { recoveredAutomatically.current = false; }, [source, attempt]);
  useEffect(() => {
    const player = audio.current;
    if (!player) return;
    const pauseForOther = (event: Event) => { if (event.target instanceof HTMLMediaElement && event.target !== player) player.pause(); };
    document.addEventListener('play', pauseForOther, true);
    player.crossOrigin = 'use-credentials';
    player.src = connectionUrl(attachmentFileUrl(source.choirId, source.attachment)); player.load();
    return () => {
      if (player.readyState >= HTMLMediaElement.HAVE_METADATA || resume.current?.source !== source) resume.current = { source, time: player.currentTime, playing: !player.paused, speed: player.playbackRate };
      document.removeEventListener('play', pauseForOther, true); player.pause(); player.removeAttribute('src'); player.load();
    };
  }, [source, attempt, route, entryReady]);
  const seekable = ready && duration > 0 && canSeek;
  const seek = (next: number) => { if (seekable && audio.current) audio.current.currentTime = Math.max(0, Math.min(duration, next)); };
  const play = () => {
    const player = audio.current;
    if (!player) return;
    if (!player.paused) player.pause();
    else { document.querySelectorAll('audio,video').forEach(other => { if (other !== player && other instanceof HTMLMediaElement) other.pause(); }); void player.play().catch(() => setError("audioCouldNotPlay")); }
  };
  return <>
    <audio ref={audio} preload="metadata" onLoadedMetadata={() => { const player = audio.current; const value = player?.duration ?? 0; setDuration(Number.isFinite(value) ? value : 0); setCanSeek(Boolean(player?.seekable.length)); if (player) { player.playbackRate = speed; if (resume.current?.source === source) { player.currentTime = resume.current.time; player.playbackRate = resume.current.speed; setSpeed(resume.current.speed); if (resume.current.playing) void player.play().catch(() => setError("audioClickToResume")); resume.current = null; } } setReady(true); setError(null); }}
      onProgress={() => { const player = audio.current; const value = player?.duration ?? 0; if (Number.isFinite(value)) setDuration(value); setCanSeek(Boolean(player?.seekable.length)); }}
      onTimeUpdate={() => setPosition(audio.current?.currentTime ?? 0)} onPlay={() => { setError(null); setPlaying(true); }} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
      onError={() => { setReady(false); setError("audioUnavailable"); if (connectionsEnabled && !recoveredAutomatically.current && audio.current?.error?.code === MediaError.MEDIA_ERR_NETWORK) { recoveredAutomatically.current = true; void connections.recoverMedia(route); } }} />
    {preview ? <AttachmentShell title={source.attachment.name} subtitle={scoreDisplayName(source.score.fileName)} onClose={stopPlayback}>
      <div className="attachment-audio practice-audio-preview">
        <div className="attachment-audio-art"><FileAudio size={36} strokeWidth={1.3} aria-hidden="true" /></div>
        <p>{t("audioAttachment")}</p>
        <Button className="practice-icon practice-play" aria-label={playing ? t("pause") : t("play")} isDisabled={!ready} onPress={play}>{playing ? <Pause size={20} fill="currentColor" aria-hidden="true" /> : <Play size={20} fill="currentColor" aria-hidden="true" />}</Button>
        <label className="practice-field"><span>{time(position)} / {time(duration)}</span><input aria-label={t("playbackPosition")} type="range" min="0" max={duration} step="0.1" value={position} disabled={!seekable} onChange={event => seek(Number(event.target.value))} /></label>
        {!ready && !error && <p role="status">{t("preparingAudio")}</p>}
        {error && <p role="alert">{t(error)}<Button className="practice-action" onPress={() => { setError(null); setReady(false); setAttempt(value => value + 1); }}>{t("retry")}</Button></p>}
        <Button className="practice-action practice-listen-score" onPress={showScore}>{t("listenAndRead")}</Button>
        <p className="practice-hint">{t("audioOfflineHint")}</p>
      </div>
    </AttachmentShell> : <AudioPracticePlayer source={source} ready={ready} playing={playing} message={error ? t(error) : !ready ? t("preparingAudio") : ""} failed={Boolean(error)}
      timeline={{value:position,max:duration,step:.1,disabled:!seekable,label:value => `${time(value)} / ${time(duration)}`,seek}}
      speed={speed} setSpeed={value => { if (audio.current) audio.current.playbackRate = value; setSpeed(value); }}
      position={time(position)} previousDisabled={!seekable || position <= 0} nextDisabled={!seekable || position >= duration}
      play={play} previous={() => seek(position - 10)} next={() => seek(position + 10)} retry={() => { setError(null); setReady(false); setAttempt(value => value + 1); }} />}
  </>;
}

// Keep fullscreen ownership scoped to looking at the score, not its audio preview.
function AudioPracticePlayer(props: Omit<ComponentProps<typeof PracticePlayerShell>, 'focus'>) {
  const focus = usePracticeFocus();
  return <PracticePlayerShell {...props} focus={focus} />;
}
