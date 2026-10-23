import {restoreSourceTextDeclarations} from './source-text-declarations.ts';
import {restoreSourceWedgeDeclarations} from './source-wedge-declarations.ts';
import { restoreMusicXmlWedgeGlyphs } from './musicxml-wedge-glyphs.ts';
import { applyMusicXmlTimeVisibility, readMusicXmlTimeVisibility } from './musicxml-hidden-time.ts';
export { preparePianoPlaybackMidi } from './piano-shared-attacks.ts';
import { bindPianoMidiCorrection } from './piano-shared-attacks.ts';
import { readMusicXmlTempoMeasures } from './musicxml-metronome.ts';
import { readMusicXmlCreatorCredits } from './musicxml-creator-credits.ts';
import * as alphaTab from '@coderline/alphatab';
import { musicXmlImportBytes, prepareMusicXmlForPlaybackBytes } from './musicxml-preparation.ts';
export { IncompatibleMusicXmlPreparationError, prepareMusicXmlForPlaybackBytes } from './musicxml-preparation.ts';
import type { PreparedMusicXml } from './musicxml-direction-timing.ts';
import { applyAlphaTabPlaybackDynamics } from './alphatab-playback-dynamics.ts';

export function loadMusicXml(bytes: Uint8Array, settings: alphaTab.Settings): alphaTab.model.Score {
  const prepared = prepareMusicXmlForPlaybackBytes(bytes);
  return loadPreparedMusicXml(prepared, settings);
}

export function loadPreparedMusicXml(prepared: PreparedMusicXml, settings: alphaTab.Settings): alphaTab.model.Score {
  const score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(musicXmlImportBytes(prepared), settings);
  // MusicXML may repeat work-title as movement-title. alphaTab renders these
  // as title + subtitle; suppress only the identical imported display line.
  // Attachment bytes and prepared source metadata remain untouched.
  if (score.title && score.subTitle === score.title) score.subTitle = '';
  const credits = prepared.creatorCredits ?? readMusicXmlCreatorCredits(prepared.bytes);
  if (credits.arrangers.length > 0) {
    // alphaTab imports an arranger into music, then labels it "Music by".
    // Keep source roles explicit on separate header lines. Clearing that generic
    // field also prevents its automatic "Words & Music" label for an arranger
    // who happens to be the lyricist. Notes and source creator tags are untouched.
    score.artist = [
      credits.composers.length > 0 ? `Music by ${credits.composers.join(', ')}` : score.artist,
      `Arranged by ${credits.arrangers.join(', ')}`,
    ].filter(Boolean).join('\n');
    score.music = '';
  }
  const tempoMeasures = prepared.tempoMeasures ?? readMusicXmlTempoMeasures(prepared.bytes);
  tempoMeasures.forEach((measure, index) => {
    const bar = score.masterBars[index];
    if (!bar || !measure.complete || measure.events.length === 0) return;
    // Match MIDI generation, including a short implicit pickup.
    const duration = bar.calculateDuration();
    if (duration <= 0) return;
    const events = new Map<number, { bpm: number; visible: boolean }>();
    for (const event of measure.events) {
      const tick = Math.round(event.quarter * 960);
      const previous = events.get(tick);
      events.set(tick, { bpm: event.bpm, visible: event.visible || previous?.visible === true });
    }
    // alphaTab derives Score.tempo from the first automation even if it starts
    // mid-bar. Keep its default opening tempo until the first source change.
    if (index === 0 && !events.has(0)) events.set(0, { bpm: 120, visible: false });
    bar.tempoAutomations = [...events].sort(([left], [right]) => left - right).map(([tick, event]) => {
      const automation = new alphaTab.model.Automation();
      automation.type = alphaTab.model.AutomationType.Tempo;
      automation.value = event.bpm;
      automation.ratioPosition = tick / duration;
      automation.isVisible = event.visible;
      return automation;
    });
  });
  applyMusicXmlTimeVisibility(score, prepared.timeVisibility ?? readMusicXmlTimeVisibility(prepared.bytes));
  applyAlphaTabPlaybackDynamics(score, prepared.partsWithExplicitDynamics, score.tracks.length, prepared.dynamicEventsByPart, prepared.wedgeEventsByPart, prepared.dynamicGlyphsCompleteByPart);
  score.tracks.forEach((track,index) => restoreMusicXmlWedgeGlyphs(track, prepared.wedgeEventsByPart?.[index] ?? []));
  score.tracks.forEach((track,index)=>{ const events=prepared.wedgeEventsByPart?.[index]; if(Array.isArray(events)) restoreSourceWedgeDeclarations(track,events); });
  score.tracks.forEach((track,index)=>restoreSourceTextDeclarations(track,prepared.wordEventsByPart?.[index]));
  return score;
}

/** Same channel isolation for the standalone and embedded player. */
export function assignPlaybackChannels(tracks: alphaTab.model.Track[]) {
  let channel = 0, percussion = 0;
  for (const track of tracks) {
    if (track.isPercussion) {
      if (++percussion > 1) throw new Error('当前不支持多个独立打击乐声部。');
      track.playbackInfo.primaryChannel = track.playbackInfo.secondaryChannel = 9;
    } else {
      if (channel === 9) channel++;
      if (channel > 15) throw new Error('独立声部数量超过播放限制。');
      track.playbackInfo.primaryChannel = track.playbackInfo.secondaryChannel = channel++;
    }
  }
}

/** Framework-independent engine creation; hosts own the surrounding controls. */
export function createPlaybackApi(element: HTMLElement, settings: ConstructorParameters<typeof alphaTab.AlphaTabApi>[1]) {
  const api = new alphaTab.AlphaTabApi(element, settings);
  bindPianoMidiCorrection(api);
  return api;
}
