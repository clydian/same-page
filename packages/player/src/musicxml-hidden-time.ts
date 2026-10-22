import * as alphaTab from '@coderline/alphatab';
import type { MusicXmlTimeVisibility } from './musicxml-time-visibility-source.ts';
export { readMusicXmlTimeVisibility, collectMusicXmlTimeVisibility } from './musicxml-time-visibility-source.ts';
export type { MusicXmlTimeVisibility } from './musicxml-time-visibility-source.ts';

/** Public per-bar paint style: keeps native glyph spacing, meter, ticks, MIDI,
 * and source bytes. Other explicitly visible staves are never made transparent. */
export function applyMusicXmlTimeVisibility(score: alphaTab.model.Score, visibility: MusicXmlTimeVisibility): void {
  if (visibility.partIds.length !== score.tracks.length) return;
  for (const part of visibility.parts) {
    const track = score.tracks[part.trackIndex];
    if (!track) continue;
    for (const measure of part.measures) {
      if (measure.staves.some(([index]) => !track.staves[index])) continue;
      const overrides = new Map(measure.staves);
      track.staves.forEach((staff, index) => {
        if ((overrides.get(index) ?? measure.all) !== false) return;
        const bar = staff.bars[measure.index];
        if (!bar) return;
        bar.style ??= new alphaTab.model.BarStyle();
        bar.style.colors.set(alphaTab.model.BarSubElement.StandardNotationTimeSignature, new alphaTab.model.Color(0, 0, 0, 0));
      });
    }
  }
}
