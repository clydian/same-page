import workletUrl from './capture-processor.js?url&no-inline';
import { loadPracticeClicks, practiceBeatAccent, schedulePracticeClicks } from '../playback/practice-metronome';
import { loadPracticeSoundFont } from '../playback/practice-soundfont';
import { createChoirBacking, scheduleChoirBacking } from './choir-backing';
import { targetPitches, type Melody, type MelodyNote } from './melody';
import { createPitchReader, frequency, pitchWindowSize, type PitchFrame } from './pitch-feedback';
import type { ChallengeMix } from './use-challenge-mix';

export type CaptureError = 'microphoneUnavailable' | 'microphoneDenied' | 'audioInterrupted' | 'audioFailure';
type CaptureCallbacks = {
  onCount(count: number): void;
  onFrame(frame: PitchFrame): void;
  onComplete(frames: PitchFrame[], recording: Blob): void;
  onError(error: CaptureError): void;
};

type CaptureMix = Pick<ChallengeMix, 'backing' | 'metronome'>;

function outputGain(context: AudioContext, level: number) {
  const gain = context.createGain();
  gain.gain.value = level;
  gain.connect(context.destination);
  return gain;
}

function setOutputLevel(gain: GainNode | undefined, level: number) {
  gain?.gain.setTargetAtTime(level, gain.context.currentTime, .01);
}

export function beginCapture(melody: Melody, callbacks: CaptureCallbacks, backing: MelodyNote[][],
  mix: CaptureMix, previewContext?: AudioContext) {
  let active = true;
  let context = previewContext, stream: MediaStream | undefined;
  let input: MediaStreamAudioSourceNode | undefined, worklet: AudioWorkletNode | undefined;
  let cancelCount: (() => void) | undefined, cancelMetronome: (() => void) | undefined;
  let cancelBacking: (() => void) | undefined;
  let backingGain: GainNode | undefined, clickGain: GainNode | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const dispose = () => {
    if (!active) return;
    active = false;
    clearTimeout(deadline);
    cancelCount?.();
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
    const microphone = navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      video: false,
    }).then(opened => {
      if (!active) opened.getTracks().forEach(track => track.stop());
      else {
        stream = opened;
        deadline = setTimeout(() => fail('audioFailure'), 5000);
      }
      return opened;
    });
    const [,, opened, clickBuffers, soundFont] = await Promise.all([resumed, prepared, microphone, clicks, backing.length ? loadPracticeSoundFont() : null]);
    if (!active) return;
    clearTimeout(deadline);
    const { sampleRate } = context;
    const choirBacking = soundFont ? createChoirBacking(backing, melody.duration, soundFont, sampleRate) : null;
    const beatFrames = Math.round(melody.beatSeconds * sampleRate);
    const durationFrames = Math.round(melody.duration * sampleRate);
    const leadInFrames = Math.round(melody.leadIn * sampleRate);
    context.addEventListener('statechange', () => {
      if (context?.state !== 'running') fail('audioInterrupted');
    });
    for (const track of opened.getAudioTracks()) track.addEventListener('ended', () => fail('audioInterrupted'), { once: true });
    input = context.createMediaStreamSource(opened);
    const half = pitchWindowSize / 2;
    // Keep the count-in, clicks, accompaniment and recording on the audio clock.
    const startFrame = Math.ceil((context.currentTime + .15) * sampleRate / 128) * 128;
    const countStart = startFrame / sampleRate;
    const countBeat = beatFrames / sampleRate;
    const countDuration = melody.beats * countBeat;
    const start = countStart + countDuration;
    worklet = new AudioWorkletNode(context, 'sight-singing-capture', {
      channelCount: 1, channelCountMode: 'explicit', outputChannelCount: [1],
      processorOptions: { beatFrames, beats: melody.beats, durationFrames, chunkFrames: half, startFrame },
    });
    worklet.onprocessorerror = () => fail('audioFailure');
    const pitch = createPitchReader(sampleRate);
    const window = new Float32Array(pitchWindowSize), chunks: ArrayBuffer[] = [];
    const frames: PitchFrame[] = [];
    let received = 0;
    worklet.port.onmessage = ({ data }: MessageEvent<{ count: number } | { samples: Float32Array; done: boolean }>) => {
      if (!active) return;
      if ('count' in data) { callbacks.onCount(data.count); return; }
      const { samples, done } = data;
      if (received > 0) {
        window.copyWithin(0, half);
        window.fill(0, half);
        window.set(samples, half);
        const frame = { time: received / sampleRate, midi: pitch(window) };
        // The pitch window straddles its timestamp. Keep lead-in audio in a
        // replay without ever feeding those samples into the score.
        if (received - half >= leadInFrames) frames.push(frame);
        callbacks.onFrame(frame);
      } else {
        window.set(samples, half);
        callbacks.onFrame({ time: 0, midi: null });
      }
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
    // A lead-in before the scored phrase is audible just like the count-in.
    const countClicks = Array.from({ length: melody.beats }, (_, beat) => ({
      time: beat * countBeat, accent: practiceBeatAccent(beat, melody.beats, melody.denominator),
    }));
    for (const click of melody.clicks) if (click.time < melody.leadIn) countClicks.push({ ...click, time: countDuration + click.time });
    cancelCount = schedulePracticeClicks(context, clickBuffers, countStart, countClicks);
    clickGain = outputGain(context, Number(mix.metronome));
    cancelMetronome = schedulePracticeClicks(context, clickBuffers, start, melody.clicks.filter(click => click.time >= melody.leadIn), clickGain);
    deadline = setTimeout(() => fail('audioInterrupted'), 5000 + (beatFrames * melody.beats + durationFrames) / sampleRate * 1000);
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

function waveFile(chunks: ArrayBuffer[], length: number, sampleRate: number) {
  const header = new DataView(new ArrayBuffer(44));
  const tag = (at: number, text: string) => [...text].forEach((character, index) => header.setUint8(at + index, character.charCodeAt(0)));
  tag(0, 'RIFF'); header.setUint32(4, 36 + length * 2, true); tag(8, 'WAVE'); tag(12, 'fmt ');
  header.setUint32(16, 16, true); header.setUint16(20, 1, true); header.setUint16(22, 1, true);
  header.setUint32(24, sampleRate, true); header.setUint32(28, sampleRate * 2, true);
  header.setUint16(32, 2, true); header.setUint16(34, 16, true); tag(36, 'data'); header.setUint32(40, length * 2, true);
  return new Blob([header.buffer, ...chunks], { type: 'audio/wav' });
}

function pcm16(samples: Float32Array) {
  const pcm = new DataView(new ArrayBuffer(samples.length * 2));
  for (let index = 0; index < samples.length; index++) {
    const level = Math.max(-1, Math.min(1, samples[index]));
    pcm.setInt16(index * 2, level * (level < 0 ? 32768 : 32767), true);
  }
  return pcm.buffer;
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

function schedulePiano(context: BaseAudioContext, notes: MelodyNote[], start: number, volume: number) {
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
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(on); oscillator.stop(off + .055);
    }
  }
}

export async function mixPianoAnswer(recording: Blob, notes: MelodyNote[], voiceVolume: number) {
  // Input is the PCM WAV produced by beginCapture. Render on the recording's
  // sample clock so the native player's seek and speed controls keep the mix aligned.
  const data = new DataView(await recording.arrayBuffer());
  const sampleRate = data.getUint32(24, true), length = data.getUint32(40, true) / 2;
  const context = new OfflineAudioContext(1, length, sampleRate);
  const buffer = context.createBuffer(1, length, sampleRate);
  const samples = buffer.getChannelData(0);
  for (let index = 0; index < length; index++) samples[index] = data.getInt16(44 + index * 2, true) / 32768;
  const source = context.createBufferSource(), gain = context.createGain();
  source.buffer = buffer;
  gain.gain.value = .78 * voiceVolume;
  source.connect(gain).connect(context.destination);
  source.start();
  schedulePiano(context, notes, 0, .18);
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
    schedulePiano(context, [{ midi, start: 0, end: .6, bar: 0, visit: 0 }], start, .23);
    const sentinel = context.createConstantSource();
    sentinel.offset.value = 0;
    sentinel.connect(context.destination);
    sentinel.onended = () => { if (active) { stop(); onFinish(false); } };
    sentinel.start(start);
    sentinel.stop(start + .655);
  }).catch(() => { if (active) { stop(); onFinish(true); } });
  return stop;
}
