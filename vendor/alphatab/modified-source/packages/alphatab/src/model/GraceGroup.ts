import { MidiUtils } from '@coderline/alphatab/midi/MidiUtils';
import { Duration } from '@coderline/alphatab/model/Duration';
import type { Beat } from '@coderline/alphatab/model/Beat';

/**
 * Represents a group of grace beats that belong together
 * @public
 */
export class GraceGroup {
    /**
     * All beats within this group.
     */
    public beats: Beat[] = [];

    /**
     * Gets a unique ID for this grace group.
     */
    public id: string = 'empty';

    /**
     * true if the grace beat are followed by a normal beat within the same
     * bar.
     */
    public isComplete: boolean = false;

    /** Source groups use stable track-local beam IDs instead of staff-local voice IDs. @internal */
    public isCrossStaff = false;

    /** @internal */
    public static defaultDuration(count: number): Duration {
        return count === 1 ? Duration.Eighth : count === 2 ? Duration.Sixteenth : Duration.ThirtySecond;
    }

    /** @internal */
    public static playbackTicks(duration: Duration): number {
        switch (duration) {
            case Duration.Sixteenth:
                return MidiUtils.toTicks(Duration.SixtyFourth);
            case Duration.ThirtySecond:
                return MidiUtils.toTicks(Duration.OneHundredTwentyEighth);
            default:
                return MidiUtils.toTicks(Duration.ThirtySecond);
        }
    }

    /**
     * Adds a new beat to this group
     * @param beat The beat to add
     */
    public addBeat(beat: Beat) {
        beat.graceIndex = this.beats.length;
        beat.graceGroup = this;
        this.beats.push(beat);
    }

    public finish() {
        if (this.beats.length > 0) {
            const first = this.beats[0];
            this.id = this.isCrossStaff
                ? `source-grace:${first.voice.bar.staff.track.index}:${first.voice.bar.index}:${first.sourceBeamGroup}`
                : `${first.absoluteDisplayStart}_${first.voice.index}`;
        }
    }
}
