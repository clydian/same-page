import workletUrl from './capture-processor.js?url&no-inline';
import type { Melody } from './melody';
import { createPitchReader, frequency, pitchWindowSize, type PitchFrame } from './pitch-feedback';

export type CaptureError = 'microphoneUnavailable' | 'microphoneDenied' | 'audioInterrupted' | 'audioFailure';
type CaptureCallbacks = {
  onCount(count: number): void;
  onFrame(frame: PitchFrame, elapsed: number): void;
  onComplete(frames: PitchFrame[], recording: Blob): void;
  onError(error: CaptureError): void;
};

export function beginCapture(melody: Melody, callbacks: CaptureCallbacks) {
  let active = true;
  let context: AudioContext | undefined, stream: MediaStream | undefined;
  let input: MediaStreamAudioSourceNode | undefined, worklet: AudioWorkletNode | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const dispose = () => {
    if (!active) return;
    active = false;
    clearTimeout(deadline);
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
    context = new AudioContext();
    const resumed = context.resume();
    const prepared = context.audioWorklet.addModule(workletUrl);
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
    const [,, opened] = await Promise.all([resumed, prepared, microphone]);
    if (!active) return;
    clearTimeout(deadline);
    const { sampleRate } = context;
    const beatFrames = Math.round(melody.beatSeconds * sampleRate);
    const durationFrames = Math.round(melody.duration * sampleRate);
    context.addEventListener('statechange', () => {
      if (context?.state !== 'running') fail('audioInterrupted');
    });
    for (const track of opened.getAudioTracks()) track.addEventListener('ended', () => fail('audioInterrupted'), { once: true });
    input = context.createMediaStreamSource(opened);
    const half = pitchWindowSize / 2;
    worklet = new AudioWorkletNode(context, 'sight-singing-capture', {
      channelCount: 1, channelCountMode: 'explicit', outputChannelCount: [1],
      processorOptions: { beatFrames, beats: melody.beats, durationFrames, chunkFrames: half },
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
        frames.push(frame);
        callbacks.onFrame(frame, (received + samples.length) / sampleRate);
      } else {
        window.set(samples, half);
        callbacks.onFrame({ time: 0, midi: null }, samples.length / sampleRate);
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
    deadline = setTimeout(() => fail('audioInterrupted'), 5000 + (beatFrames * melody.beats + durationFrames) / sampleRate * 1000);
  })().catch((reason: unknown) => {
    const name = reason instanceof DOMException ? reason.name : '';
    fail(name === 'NotAllowedError' || name === 'SecurityError' ? 'microphoneDenied' : name === 'NotFoundError' ? 'microphoneUnavailable' : 'audioFailure');
  });
  return dispose;
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

export function playMelody(melody: Melody, firstOnly: boolean, onFinish: (failed: boolean) => void) {
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
    for (const note of firstOnly ? melody.notes.slice(0, 1) : melody.notes) {
      const oscillator = context.createOscillator(), gain = context.createGain();
      const on = start + (firstOnly ? 0 : note.start);
      const end = firstOnly ? on + .6 : start + note.end;
      const ramp = Math.min(.025, (end - on) / 3);
      oscillator.frequency.value = frequency(note.midi);
      gain.gain.setValueAtTime(0, on);
      gain.gain.linearRampToValueAtTime(.23, on + ramp);
      gain.gain.setValueAtTime(.23, end - ramp);
      gain.gain.linearRampToValueAtTime(0, end);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(on); oscillator.stop(end);
    }
    const sentinel = context.createConstantSource();
    sentinel.offset.value = 0;
    sentinel.connect(context.destination);
    sentinel.onended = () => { if (active) { stop(); onFinish(false); } };
    sentinel.start(start);
    sentinel.stop(start + (firstOnly ? .6 : melody.duration));
  }).catch(() => { if (active) { stop(); onFinish(true); } });
  return stop;
}
