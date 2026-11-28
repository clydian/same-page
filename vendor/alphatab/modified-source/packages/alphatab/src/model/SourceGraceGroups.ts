import type { Beat } from '@coderline/alphatab/model/Beat';
import { GraceGroup } from '@coderline/alphatab/model/GraceGroup';
import { GraceType } from '@coderline/alphatab/model/GraceType';
import type { Track } from '@coderline/alphatab/model/Track';

/** Complete MusicXML source beams carry the document order across staff-local voices. @internal */
export class SourceGraceGroups {
    private readonly _groups: { grace: GraceGroup; anchor: Beat }[] = [];

    public static collect(track: Track): SourceGraceGroups {
        const result = new SourceGraceGroups();
        if (track.staves.length < 2) {
            return result;
        }
        const members = new Map<string, Beat[]>();
        for (const staff of track.staves) {
            for (const bar of staff.bars) {
                for (const voice of bar.voices) {
                    for (const beat of voice.beats) {
                        if (!beat.sourceBeamGroup || beat.graceType === GraceType.None) {
                            continue;
                        }
                        const key = `${bar.index}:${beat.sourceBeamGroup}`;
                        const group = members.get(key) ?? [];
                        group.push(beat);
                        members.set(key, group);
                    }
                }
            }
        }
        for (const beats of members.values()) {
            beats.sort((a, b) => a.sourceBeamGroupIndex - b.sourceBeamGroupIndex);
            const last = beats[beats.length - 1];
            const anchor = last.voice.beats[last.index + 1];
            if (
                beats.length !== last.sourceBeamGroupSize ||
                !beats.every((beat, index) => beat.sourceBeamGroupIndex === index) ||
                !anchor ||
                anchor.graceType !== GraceType.None
            ) {
                continue;
            }
            const grace = new GraceGroup();
            grace.isComplete = true;
            grace.isCrossStaff = true;
            for (const beat of beats) {
                grace.addBeat(beat);
            }
            result._groups.push({ grace, anchor });
        }
        return result;
    }

    public finishPlayback(): void {
        for (const { grace, anchor } of this._groups) {
            const duration = grace.beats.reduce((ticks, beat) => ticks + beat.playbackDuration, 0);
            const first = grace.beats[0];
            let tick = anchor.playbackStart;
            if (first.graceType === GraceType.BeforeBeat) {
                tick -= duration;
                const bar = anchor.voice.bar;
                const previous = bar.staff.track.staves.flatMap(
                    staff => staff.bars[bar.index].voices[anchor.voice.index]?.beats ?? []
                ).find(beat =>
                    !beat.isEmpty &&
                    beat.graceType === GraceType.None &&
                    beat.displayStart < anchor.displayStart &&
                    beat.displayEnd === anchor.displayStart &&
                    beat.playbackStart + beat.playbackDuration === anchor.playbackStart
                );
                if (previous) {
                    previous.playbackDuration -= duration;
                }
            } else {
                anchor.voice.movePlaybackBeat(anchor, tick + duration);
                anchor.playbackDuration -= duration;
            }
            for (const beat of grace.beats) {
                beat.playbackStart = tick;
                tick += beat.playbackDuration;
            }
        }
    }
}
