import workletUrl from './capture-processor.js?url&no-inline';
import { pcm16, waveFile } from '../playback/pcm-audio';
import { loadPracticeClicks, practiceBeatAccent, schedulePracticeClick, schedulePracticeClicks } from '../playback/practice-metronome';
import { loadPracticeSoundFont } from '../playback/practice-soundfont';
import { createChoirBacking, scheduleChoirBacking } from './choir-backing';
import { targetPitches, type Melody, type PlaybackNote } from './melody';
import { createLivePitch, livePitchChunkSize } from './live-pitch';
import { frequency, type PitchFrame } from './pitch-feedback';
import { calibrationDuration, calibrationTimes, calibrationTone, estimateRecordingLatency,
  recordingOffsetFrames } from './recording-latency';
import type { ChallengeMix } from './use-challenge-mix';

export type CaptureError = 'microphoneUnavailable' | 'microphoneDenied' | 'audioInterrupted' | 'audioFailure';
type CaptureCallbacks = {
  onCount(count: number): void;
  onFrame(frame: PitchFrame, pitchFrames: PitchFrame[]): void;
  onComplete(pitchFrames: PitchFrame[], recording: Blob): void;
  onError(error: CaptureError): void;
};

type CaptureMix = Pick<ChallengeMix, 'backing' | 'metronome'>;

const microphoneConstraints: MediaStreamConstraints = {
  audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  video: false,
};

export async function measureRecordingLatency(signal: AbortSignal) {
  const context = new AudioContext();
  let stream: MediaStream | undefined, worklet: AudioWorkletNode | undefined;
  const cleanup = () => {
    stream?.getTracks().forEach(track => track.stop());
    worklet?.port.close();
    worklet?.disconnect();
    if (context.state !== 'closed') void context.close().catch(() => {});
  };
  signal.addEventListener('abort', cleanup, { once: true });
  try {
    signal.throwIfAborted();
    const microphone = navigator.mediaDevices.getUserMedia(microphoneConstraints).then(opened => {
      if (signal.aborted || context.state === 'closed') opened.getTracks().forEach(track => track.stop());
      else stream = opened;
      return opened;
    });
    const [opened] = await new Promise<[MediaStream, void, void]>((resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      void Promise.all([microphone, context.resume(), context.audioWorklet.addModule(workletUrl)])
        .then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
    signal.throwIfAborted();
    const { sampleRate } = context;
    const tone = calibrationTone(sampleRate);
    const durationFrames = Math.ceil(calibrationDuration * sampleRate);
    const startFrame = Math.ceil((context.currentTime + .15) * sampleRate / 128) * 128;
    worklet = new AudioWorkletNode(context, 'sight-singing-capture', {
      channelCount: 1, channelCountMode: 'explicit', outputChannelCount: [1],
      processorOptions: { beats: 0, beatFrames: 0, durationFrames, chunkFrames: 4096, startFrame },
    });
    const recorder = worklet;
    const input = context.createMediaStreamSource(opened);
    input.connect(recorder).connect(context.destination);
    const buffer = context.createBuffer(1, tone.length, sampleRate);
    buffer.getChannelData(0).set(tone);
    for (const time of calibrationTimes) {
      const pulse = context.createBufferSource();
      pulse.buffer = buffer;
      pulse.connect(context.destination);
      pulse.start((startFrame + Math.round(time * sampleRate)) / sampleRate);
    }
    const samples = new Float32Array(durationFrames);
    let received = 0;
    return await new Promise<number | null>((resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      recorder.onprocessorerror = () => { signal.removeEventListener('abort', abort); reject(new Error('capture_failed')); };
      recorder.port.onmessage = ({ data }: MessageEvent<{ samples: Float32Array; done: boolean }>) => {
        samples.set(data.samples, received);
        received += data.samples.length;
        if (data.done) {
          signal.removeEventListener('abort', abort);
          resolve(estimateRecordingLatency(samples, tone, sampleRate));
        }
      };
    });
  } finally {
    signal.removeEventListener('abort', cleanup);
    cleanup();
  }
}

function outputGain(context: BaseAudioContext, level: number) {
  const gain = context.createGain();
  gain.gain.value = level;
  gain.connect(context.destination);
  return gain;
}

function setOutputLevel(gain: GainNode | undefined, level: number) {
  gain?.gain.setTargetAtTime(level, gain.context.currentTime, .01);
}

export function beginCapture(melody: Melody, callbacks: CaptureCallbacks, backing: PlaybackNote[][],
  mix: CaptureMix, latency: number, previewContext?: AudioContext) {
  let active = true;
  let context = previewContext, stream: MediaStream | undefined;
  let input: MediaStreamAudioSourceNode | undefined, worklet: AudioWorkletNode | undefined;
  let cancelMetronome: (() => void) | undefined;
  let cancelBacking: (() => void) | undefined;
  let backingGain: GainNode | undefined, clickGain: GainNode | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const dispose = () => {
    if (!active) return;
    active = false;
    clearTimeout(deadline);
    cancelMetronome?.();
    cancelBacking?.();
    stream?.getTracks().forEach(track => track.stop());
    worklet?.port.close();
    worklet?.disconnect();
    input?.disconnect();
    if (context && context.state !== 'closed') void context.close().catch(() => {});
  };
  const fail = (reason: CaptureError) => {
    if (!active) return;
    dispose();
    callbacks.onError(reason);
  };
  void (async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === 'undefined' || typeof AudioWorkletNode === 'undefined') {
      queueMicrotask(() => fail('microphoneUnavailable'));
      return;
    }
    context ??= new AudioContext();
    const resumed = context.resume();
    const prepared = context.audioWorklet.addModule(workletUrl);
    const clicks = loadPracticeClicks(context);
    // Permission can outlive cancellation. Claim its stream independently of
    // the worklet and stop late tracks even if another setup step failed.
    const microphone = navigator.mediaDevices.getUserMedia(microphoneConstraints).then(opened => {
      if (!active) opened.getTracks().forEach(track => track.stop());
      else {
        stream = opened;
        deadline = setTimeout(() => fail('audioFailure'), 5000);
      }
      return opened;
    });
    const [,, opened, clickBuffers, soundFont] = await Promise.all([resumed, prepared, microphone, clicks, backing.length ? loadPracticeSoundFont() : null]);
    if (!active) return;
    // Opening the microphone can restart the output route after the initial
    // gesture has unlocked Web Audio. Wait for output again before counting in.
    await context.resume();
    if (!active) return;
    clearTimeout(deadline);
    const { sampleRate } = context;
    const choirBacking = soundFont ? createChoirBacking(backing, melody.duration, soundFont, sampleRate) : null;
    const beatFrames = Math.round(melody.beatSeconds * sampleRate);
    const durationFrames = Math.round(melody.duration * sampleRate);
    const margin = recordingOffsetFrames(sampleRate, 0);
    context.addEventListener('statechange', () => {
      if (context?.state !== 'running') fail('audioInterrupted');
    });
    for (const track of opened.getAudioTracks()) track.addEventListener('ended', () => fail('audioInterrupted'), { once: true });
    input = context.createMediaStreamSource(opened);
    // Keep the count-in, clicks, accompaniment and recording on the audio clock.
    const startFrame = Math.ceil((context.currentTime + .15) * sampleRate / 128) * 128;
    // Fast count-ins can be shorter than the pre-roll needed for negative offsets.
    const countOffset = Math.max(0, margin - beatFrames * melody.beats);
    const countStart = (startFrame + countOffset) / sampleRate;
    const countBeat = beatFrames / sampleRate;
    const start = countStart + melody.beats * countBeat;
    worklet = new AudioWorkletNode(context, 'sight-singing-capture', {
      channelCount: 1, channelCountMode: 'explicit', outputChannelCount: [1],
      processorOptions: { beatFrames, beats: melody.beats,
        durationFrames: durationFrames + margin, recordFrom: -margin, countOffset, chunkFrames: livePitchChunkSize, startFrame },
    });
    worklet.onprocessorerror = () => fail('audioFailure');
    const offset = latency / 1000;
    const pitch = createLivePitch(sampleRate, undefined, margin + offset * sampleRate);
    const frames = pitch.frames('clear');
    const chunks: ArrayBuffer[] = [];
    let received = 0;
    worklet.port.onmessage = ({ data }: MessageEvent<{ count: number } | { samples: Float32Array; done: boolean }>) => {
      if (!active) return;
      if ('count' in data) { callbacks.onCount(data.count); return; }
      const { samples, done } = data;
      pitch.append(samples);
      const current = pitch.current('clear');
      // The singer's samples are calibrated, while the accompaniment/playhead
      // stay on the worklet's unshifted clock.
      const time = current.time + offset;
      if (time >= 0 && time < melody.duration) callbacks.onFrame({ ...current, time }, frames);
      chunks.push(pcm16(samples));
      received += samples.length;
      if (done) {
        dispose();
        callbacks.onComplete(frames, waveFile(chunks, received, sampleRate));
      }
    };
    input.connect(worklet);
    // No microphone samples are copied to the node output.
    worklet.connect(context.destination);
    // Queue the full count-in and any lead-in on the audio clock before the score redraws.
    for (let beat = 0; beat < melody.beats; beat++) {
      const accent = practiceBeatAccent(beat, melody.beats, melody.denominator);
      schedulePracticeClick(context, clickBuffers[accent], countStart + beat * countBeat);
    }
    const singingClicks: typeof melody.clicks = [];
    for (const click of melody.clicks) {
      if (click.time < melody.leadIn) schedulePracticeClick(context, clickBuffers[click.accent], start + click.time);
      else singingClicks.push(click);
    }
    clickGain = outputGain(context, Number(mix.metronome));
    cancelMetronome = schedulePracticeClicks(context, clickBuffers, start, singingClicks, clickGain);
    deadline = setTimeout(() => fail('audioInterrupted'), 5000 + (beatFrames * melody.beats + durationFrames + margin) / sampleRate * 1000);
    if (choirBacking) {
      backingGain = outputGain(context, mix.backing);
      cancelBacking = scheduleChoirBacking(context, choirBacking, start, backingGain, () => fail('audioFailure'));
    }
  })().catch((reason: unknown) => {
    const name = reason instanceof DOMException ? reason.name : '';
    fail(name === 'NotAllowedError' || name === 'SecurityError' ? 'microphoneDenied' : name === 'NotFoundError' ? 'microphoneUnavailable' : 'audioFailure');
  });
  return {
    stop: dispose,
    setMix(next: CaptureMix) {
      if (next.backing !== mix.backing) setOutputLevel(backingGain, next.backing);
      if (next.metronome !== mix.metronome) setOutputLevel(clickGain, Number(next.metronome));
      mix = next;
    },
  };
}

export function playSustainedTonic(midi: number, volume: number, onError: () => void) {
  const context = new AudioContext();
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (context.state !== 'closed') void context.close().catch(() => {});
  };
  try {
    const oscillator = context.createOscillator(), gain = context.createGain();
    const output = outputGain(context, volume);
    const start = context.currentTime;
    oscillator.frequency.value = frequency(midi);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(.075, start + .02);
    oscillator.connect(gain).connect(output);
    oscillator.start(start);
    void context.resume().catch(() => { if (!stopped) { stop(); onError(); } });
    return {
      context, stop,
      setPitch: (pitch: number) => oscillator.frequency.setTargetAtTime(frequency(pitch), context.currentTime, .01),
      setVolume: (volume: number) => setOutputLevel(output, volume),
    };
  } catch (error) {
    stop();
    throw error;
  }
}

function schedulePiano(context: BaseAudioContext, notes: PlaybackNote[], start: number, volume: number, output: AudioNode = context.destination) {
  const tone = context.createPeriodicWave(new Float32Array(7), Float32Array.of(0, 1, .34, .26, .14, .09, .045));
  for (const note of notes) {
    const pitches = targetPitches(note);
    const on = start + note.start, off = start + note.end, level = volume / Math.sqrt(pitches.length);
    for (const midi of pitches) {
      const oscillator = context.createOscillator(), gain = context.createGain();
      oscillator.setPeriodicWave(tone);
      oscillator.frequency.value = frequency(midi);
      gain.gain.setValueAtTime(0, on);
      gain.gain.linearRampToValueAtTime(level, on + Math.min(.007, (off - on) / 3));
      gain.gain.exponentialRampToValueAtTime(Math.max(.001, level * Math.exp(-(off - on) * 4)), off);
      gain.gain.exponentialRampToValueAtTime(.0001, off + .055);
      oscillator.connect(gain).connect(output);
      oscillator.start(on); oscillator.stop(off + .055);
    }
  }
}

export async function mixPianoAnswer(recording: Blob, notes: PlaybackNote[], voiceVolume: number, pianoVolume: number, duration: number, latencyMs: number) {
  // Input is the PCM WAV produced by beginCapture. Render on the recording's
  // sample clock so the native player's seek and speed controls keep the mix aligned.
  const data = new DataView(await recording.arrayBuffer());
  const sampleRate = data.getUint32(24, true), length = Math.round(duration * sampleRate);
  const offset = recordingOffsetFrames(sampleRate, latencyMs);
  const recordedLength = data.getUint32(40, true) / 2;
  const context = new OfflineAudioContext(1, length, sampleRate);
  const buffer = context.createBuffer(1, length, sampleRate);
  const samples = buffer.getChannelData(0);
  for (let index = 0; index < length && index + offset < recordedLength; index++) samples[index] = data.getInt16(44 + (index + offset) * 2, true) / 32768;
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(outputGain(context, .78 * voiceVolume));
  source.start();
  if (pianoVolume > 0) schedulePiano(context, notes, 0, .18, outputGain(context, pianoVolume));
  const mixed = await context.startRendering();
  return waveFile([pcm16(mixed.getChannelData(0))], length, sampleRate);
}

export function playNote(midi: number, onFinish: (failed: boolean) => void) {
  const context = new AudioContext();
  let active = true;
  const stop = () => {
    if (!active) return;
    active = false;
    if (context.state !== 'closed') void context.close().catch(() => {});
  };
  void context.resume().then(() => {
    if (!active) return;
    const start = context.currentTime + .04;
    schedulePiano(context, [{ midi, start: 0, end: .6 }], start, .23);
    const sentinel = context.createConstantSource();
    sentinel.offset.value = 0;
    sentinel.connect(context.destination);
    sentinel.onended = () => { if (active) { stop(); onFinish(false); } };
    sentinel.start(start);
    sentinel.stop(start + .655);
  }).catch(() => { if (active) { stop(); onFinish(true); } });
  return stop;
}
