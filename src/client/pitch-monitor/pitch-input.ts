import workletUrl from '../sight-singing/capture-processor.js?url&no-inline';
import { createLivePitch, livePitchChunkSize } from '../sight-singing/live-pitch';
import type { PitchFrame } from '../sight-singing/pitch-feedback';

type PitchInputChunk = {
  current: PitchFrame;
  frames: PitchFrame[];
  samples: Float32Array;
  rate: number;
  startTime: number;
  finalTime: number;
};

// The standalone monitor covers up through D♯8 without changing sight-singing scoring.
const monitorMaxHz = 5000;

export async function openPitchInput(signal: AbortSignal, onChunk: (chunk: PitchInputChunk) => void, onEnded: () => void, onNeedsGesture: (resume: () => void) => void) {
  if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === 'undefined' || typeof AudioWorkletNode === 'undefined') {
    throw new DOMException('Microphone is unavailable', 'NotSupportedError');
  }
  const context = new AudioContext();
  let stream: MediaStream | undefined, node: AudioWorkletNode | undefined;
  const close = () => {
    signal.removeEventListener('abort', close);
    node?.port.close();
    node?.disconnect();
    stream?.getTracks().forEach(track => track.stop());
    if (context.state !== 'closed') void context.close().catch(() => {});
  };
  signal.addEventListener('abort', close, { once: true });
  try {
    signal.throwIfAborted();
    const microphone = navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    }).then(opened => {
      if (signal.aborted || context.state === 'closed') opened.getTracks().forEach(track => track.stop());
      else stream = opened;
      return opened;
    });
    const ready = Promise.all([microphone, context.audioWorklet.addModule(workletUrl)]).then(([opened]) => {
      signal.throwIfAborted();
      if (context.state !== 'running') onNeedsGesture(() => { void context.resume().catch(() => {}); });
      return opened;
    });
    const [opened] = await Promise.all([ready, context.resume()]);
    signal.throwIfAborted();
    const { sampleRate } = context;
    const pitch = createLivePitch(sampleRate, monitorMaxHz, 0, 8);
    let received = 0;
    node = new AudioWorkletNode(context, 'sight-singing-capture', {
      channelCount: 1, channelCountMode: 'explicit', outputChannelCount: [1],
      processorOptions: { beatFrames: 0, beats: 0, durationFrames: Infinity, chunkFrames: livePitchChunkSize },
    });
    node.port.onmessage = ({ data }: MessageEvent<{ samples: Float32Array }>) => {
      if (signal.aborted) return;
      const { samples } = data;
      const current = pitch.append(samples);
      onChunk({ current, frames: pitch.frames, samples, rate: sampleRate,
        startTime: received / sampleRate, finalTime: pitch.finalTime });
      received += samples.length;
    };
    node.onprocessorerror = onEnded;
    opened.getAudioTracks().forEach(track => track.addEventListener('ended', onEnded, { once: true }));
    // The worklet outputs silence; microphone audio is never monitored back.
    context.createMediaStreamSource(opened).connect(node).connect(context.destination);
    return opened;
  } catch (error) {
    close();
    throw error;
  }
}
