# MusicXML note repeat passes

`note@time-only` gives the one-based repeat passes on which a written note
sounds. The notation remains present in all printed passes. Import retains this
as `Note.repeatPasses` (nullable, cloned and serialized). A missing field in old
JSON preserves unconditional playback. No English-caption inference is used.

The bounded implemented path handles ordinary pitched notes and chord members,
including same-pitch plain ties within a normally traversed repeated section.
An excluded note emits no NoteOn or NoteOff. A source tie into an excluded
endpoint stops at the eligible origin's own end; an eligible destination with
an excluded origin attacks anew. Visible tie links are preserved. Subsequent
unconditional notes resume normally. The innermost repeat pass is used, with
alternate endings and successive repeat groups tested separately.

Complex slide, bend, roll/paired tremolo, grace and ties that cross repeat/jump
navigation boundaries are not certified by this change. Explicit `tie@time-only`
is a distinct unsupported parameter. These limits must remain visible in score
acceptance; ordinary tie examples do not certify every conditional performance.

Reference: https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/note/

The cue integration uses one shared playback eligibility predicate:
`!note.isCue && (unconditional || eligibleRepeatPass)`. Both tie endpoints must
be eligible on the current traversal before their visual tie can suppress an
attack or extend sound. A visually connected cue remains silent on every pass;
an ordinary note after it still attacks, and ordinary duration cannot extend
into a cue. Shared chord staccato uses the same sounding-tie eligibility rather
than only the presence of a visual tie. JSON/clone retain both cue and pass fields.
