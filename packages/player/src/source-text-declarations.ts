import * as at from '@coderline/alphatab';
import type { MusicXmlWordEvent } from './musicxml-direction-timing.ts';
const genericFontFamilies = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui']);

/** Display-only complete source words for a part; never mutates notes or tempo. */
export function restoreSourceTextDeclarations(track: at.model.Track, events: MusicXmlWordEvent[] | null | undefined): boolean {
    if (!Array.isArray(events) || events.length === 0 || typeof at.model.SourceText !== 'function') return false;
    const staged = new Map<at.model.Bar, at.model.SourceText[]>();
    for (const event of events) {
        const staff = track.staves[(event.staff ?? 1) - 1];
        const bar = staff?.bars[event.measureIndex], start = event.quarter * 960;
        if (!bar || !Number.isSafeInteger(event.measureIndex) || !Number.isFinite(start) || start < 0 ||
            start > bar.masterBar.calculateDuration() || typeof event.text !== 'string' || !event.text.length ||
            (event.placement !== undefined && !['above','below'].includes(event.placement)) ||
            (event.fontFamilies !== undefined && (!Array.isArray(event.fontFamilies) || event.fontFamilies.length === 0 ||
                !event.fontFamilies.every(family => genericFontFamilies.has(family))))) return false;
        // Grace display time differs from source musical time. Preserve legacy
        // for the complete part rather than snapping an authored direction.
        if (bar.voices.some(v => v.beats.some(b => b.displayStart !== b.playbackStart))) return false;
        const item = Object.assign(new at.model.SourceText(), {
            displayStart: start, text: event.text,
            ...(event.fontFamilies ? {fontFamilies:[...event.fontFamilies]}:{}),
            ...(event.placement ? {placement:event.placement === 'below' ? at.model.SourceTextPlacement.Below : at.model.SourceTextPlacement.Above}:{}),
            ...(event.fontSize ? {fontSize:event.fontSize * 96 / 72}:{}),
            ...(event.italic !== undefined ? {italic:event.italic}:{}),
            ...(event.bold !== undefined ? {bold:event.bold}:{})
        });
        const values = staged.get(bar) ?? []; values.push(item); staged.set(bar, values);
    }
    for (const staff of track.staves) for (const bar of staff.bars) bar.sourceTexts = staged.get(bar) ?? [];
    return true;
}
