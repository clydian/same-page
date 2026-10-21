/** Source syllabic relationship, independent of pitch ties and slurs. @public */
export enum LyricSyllabic {
    Single = 0,
    Begin = 1,
    Middle = 2,
    End = 3
}
/** Source melisma line endpoint. None preserves legacy text-only lyrics. @public */
export enum LyricExtension {
    None = 0,
    Start = 1,
    Continue = 2,
    Stop = 3
}

/** Source lyric placement relative to the notation staff. @public */
export enum LyricPlacement {
    Below = 0,
    Above = 1
}

/**
 * Source lyric semantics, separate from note-level pitch ties and slurs.
 * Text remains in Beat.lyrics for backwards compatibility.
 * @json
 * @cloneable
 * @public
 */
export class LyricElement {
    public placement: LyricPlacement = LyricPlacement.Below;
    public syllabic: LyricSyllabic = LyricSyllabic.Single;
    public extension: LyricExtension = LyricExtension.None;
}
