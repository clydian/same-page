import { midi } from '@coderline/alphatab';
import { TONE_PROFILES } from '@same-page/player/timbre-profile';
import { exportPracticeAudio } from '../playback/practice-soundfont';
import { targetPitches, type PlaybackNote } from './melody';

export function createChoirBacking(backing: PlaybackNote[][], duration: number, soundFont: Uint8Array, sampleRate: number) {
  const file = new midi.MidiFile();
  file.division = 1000;
  const handler = new midi.AlphaSynthMidiFileHandler(file);
  handler.addTempo(0, 60);
  handler.addControlChange(0, 0, 0, midi.ControllerType.BankSelectCoarse, TONE_PROFILES.choir.bank);
  handler.addProgramChange(0, 0, 0, TONE_PROFILES.choir.program);
  const ringing = new Map<number, { start: number; end: number }>();
  const addPitch = (pitch: number, { start, end }: { start: number; end: number }) =>
    handler.addNote(0, start, end - start, pitch, 80, 0);
  for (const note of backing.flat().sort((a, b) => a.start - b.start)) {
    const start = Math.round(note.start * file.division), end = Math.max(start + 1, Math.round(note.end * file.division));
    for (const pitch of targetPitches(note)) {
      const current = ringing.get(pitch);
      // Overlapping unisons share a voice, so one part releasing does not mute another.
      if (current && start < current.end) { current.end = Math.max(current.end, end); continue; }
      if (current) addPitch(pitch, current);
      ringing.set(pitch, { start, end });
    }
  }
  for (const [pitch, note] of ringing) addPitch(pitch, note);
  handler.finishTrack(0, Math.ceil(duration * file.division));
  return exportPracticeAudio(file, soundFont, sampleRate, .75 / Math.sqrt(backing.length));
}

export function scheduleChoirBacking(context: AudioContext, backing: ReturnType<typeof createChoirBacking>, start: number, output: AudioNode, onError: () => void) {
  let scheduledFrames = 0;
  const schedule = () => {
    try {
      const until = context.currentTime + 1.25;
      let when = start + scheduledFrames / context.sampleRate;
      while (when < until) {
        const chunk = backing.render(500);
        if (!chunk) { clearInterval(timer); return; }
        const length = chunk.samples.length / 2;
        const buffer = context.createBuffer(2, length, context.sampleRate);
        const left = buffer.getChannelData(0), right = buffer.getChannelData(1);
        for (let i = 0; i < length; i++) { left[i] = chunk.samples[2 * i]; right[i] = chunk.samples[2 * i + 1]; }
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(output);
        // Advance by actual frames because alphaTab rounds to its synthesis blocks.
        source.start(Math.max(when, context.currentTime), Math.max(0, context.currentTime - when));
        scheduledFrames += length;
        when = start + scheduledFrames / context.sampleRate;
      }
    } catch { clearInterval(timer); onError(); }
  };
  const timer = setInterval(schedule, 200);
  schedule();
  return () => clearInterval(timer);
}
