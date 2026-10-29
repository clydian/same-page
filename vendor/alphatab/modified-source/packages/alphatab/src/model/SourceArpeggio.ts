import type { Note } from '@coderline/alphatab/model/Note';

/** The arrow on an authored arpeggio; None still plays from low to high.
 * @public
 */
export enum SourceArpeggioDirection {
    None = 0,
    Up = 1,
    Down = 2
}

/** A MusicXML arpeggiate membership on one note head.
 * @json
 * @json_strict
 * @cloneable
 * @public
 */
export class SourceArpeggio {
    /** Simultaneous members with the same number in a part form one roll. */
    public number: number = 1;
    /** An absent arrow is distinct from an explicitly upward arrow. */
    public direction: SourceArpeggioDirection = SourceArpeggioDirection.None;
    /** Optional engraving hint; not required to join staves. */
    public unbroken: boolean | null = null;

    /** Collect only explicitly authored, non-stringed members at this written onset.
     * @internal
     */
    public static members(note: Note): Note[] {
        const beat = note.beat;
        const result: Note[] = [];
        if (!note.sourceArpeggio || note.isStringed || note.isPercussion) {
            return result;
        }
        for (const staff of beat.voice.bar.staff.track.staves) {
            const bar = staff.bars[beat.voice.bar.index];
            if (!bar) {
                continue;
            }
            for (const voice of bar.voices) {
                for (const candidate of voice.beats) {
                    if (candidate.playbackStart !== beat.playbackStart || candidate.graceType !== beat.graceType) {
                        continue;
                    }
                    for (const member of candidate.notes) {
                        if (
                            !member.isStringed &&
                            !member.isPercussion &&
                            member.sourceArpeggio?.number === note.sourceArpeggio.number
                        ) {
                            result.push(member);
                        }
                    }
                }
            }
        }
        return result;
    }
}
