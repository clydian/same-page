import * as alphaTab from '@coderline/alphatab';
import type { MusicXmlWedgeEvent } from './musicxml-direction-timing.ts';
export function restoreSourceWedgeDeclarations(track: alphaTab.model.Track, events: MusicXmlWedgeEvent[]): boolean {
    if (typeof alphaTab.model.SourceWedge !== 'function')
        return false;
    for (const staff of track.staves)
        for (const bar of staff.bars)
            for (const voice of bar.voices)
                for (const beat of voice.beats)
                    if (!beat.isEmpty && (beat.graceType !== alphaTab.model.GraceType.None ||
                        beat.displayStart !== beat.playbackStart || beat.playbackStart < 0 ||
                        beat.playbackStart + beat.playbackDuration > bar.masterBar.calculateDuration() + 1e-6))
                        return false;
    const active = new Map<string, MusicXmlWedgeEvent>();
    const spans: {start: MusicXmlWedgeEvent; stop: MusicXmlWedgeEvent; from: number; to: number; staff: number}[] = [];
    const tick = (event: MusicXmlWedgeEvent): number | null => {
        const bar = track.score.masterBars[event.measureIndex], local = event.quarter * 960;
        if (!bar || !Number.isSafeInteger(event.measureIndex) || typeof event.quarter !== "number" || !Number.isFinite(local) || local < 0 ||
            local > bar.calculateDuration())
            return null;
        return bar.start + local;
    };
    for (const event of [...events].sort((a, b) => a.measureIndex - b.measureIndex || a.quarter - b.quarter)) {
        if (tick(event) === null ||
            (event.staff !== null && (!Number.isSafeInteger(event.staff) || !track.staves[event.staff - 1])) ||
            (event.placement !== undefined && event.placement !== 'above' && event.placement !== 'below'))
            return false;
        const start = active.get(event.number);
        if (event.type === 'continue') {
            if (!start || (start.placement !== undefined && event.placement !== undefined && start.placement !== event.placement))
                return false;
        }
        else if (event.type === 'stop') {
            if (!start)
                return false;
            const from = tick(start)!, to = tick(event)!, staff = (start.staff ?? 1) - 1;
            if (!track.staves[staff] || to <= from || (start.placement !== undefined && event.placement !== undefined && start.placement !== event.placement))
                return false;
                spans.push({ start, stop: event, from, to, staff });
            active.delete(event.number);
        }
        else if (event.type === 'crescendo' || event.type === 'diminuendo') {
            if (start)
                return false;
            active.set(event.number, event);
        }
        else
            return false;
    }
    if (active.size > 0)
        return false;
    const declarations = new Map<alphaTab.model.Bar, alphaTab.model.SourceWedge[]>();
    for (const [index, span] of spans.entries()) {
        const { start, stop, from, to, staff } = span;
        const placement = start.placement ?? stop.placement;
        let covered = 0;
        for (const bar of track.staves[staff].bars) {
            const barStart = bar.masterBar.start, barEnd = barStart + bar.masterBar.calculateDuration();
            const segmentStart = Math.max(from, barStart), segmentEnd = Math.min(to, barEnd);
            if (segmentEnd <= segmentStart)
                continue;
            covered += segmentEnd - segmentStart;
            const values = declarations.get(bar) ?? [];
            values.push(Object.assign(new alphaTab.model.SourceWedge(), {
                sourceId: `source-wedge-${index}`,
                displayStart: segmentStart - barStart, displayEnd: segmentEnd - barStart,
                startProgress: (segmentStart - from) / (to - from), endProgress: (segmentEnd - from) / (to - from),
                type: start.type === 'crescendo' ? alphaTab.model.CrescendoType.Crescendo : alphaTab.model.CrescendoType.Decrescendo,
                ...(placement ? { placement: placement === 'above' ? alphaTab.model.SourceWedgePlacement.Above : alphaTab.model.SourceWedgePlacement.Below } : {}),
            }));
            declarations.set(bar, values);
        }
        if (Math.abs(covered - (to - from)) > 1e-6)
            return false;
    }
    for (const staff of track.staves)
        for (const bar of staff.bars)
            bar.sourceWedges = declarations.get(bar) ?? [];
    return true;
}
