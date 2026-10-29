# Authored arpeggios on non-stringed pitched instruments

MusicXML `arpeggiate` is per-note membership. The MusicXML 4.0 schema says
“this note is part of an arpeggiated chord”; its `non-arpeggiate` description
explicitly contrasts endpoint-only notation with `arpeggiate` on each note.
A single tag therefore does not establish participation of every unmarked chord
head. An importer or transcription must mark every intended member.

Sources: [arpeggiate](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/arpeggiate/)
and [non-arpeggiate](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/non-arpeggiate/).

## Model and grouping

`Note.sourceArpeggio` retains a group number, arrow direction and nullable
`unbroken` hint. The note field is nullable so legacy JSON remains readable.
Typed JSON, JSON text and deep note clones preserve these fields. The new model
is additive: `brushType` and `brushDuration` remain the legacy stringed/AlphaTex
path, including legacy JSON without `sourceArpeggio`.

For non-stringed pitched notes, explicitly marked heads in the same part,
written measure/onset and grace kind, with the same number, form one group
across voices and staves. Different numbers form independent groups. The
omitted number means 1. Unmarked notes, other parts, other onsets and percussion
are not absorbed. New MusicXML uses strict per-head membership; historical
beat-level brush JSON continues its historical behavior. The fix does not turn
non-stringed legacy brush JSON into newly authored rolls.

The omitted direction means low to high playback **without an arrow**. `up`
and `down` select both the corresponding order and explicit arrow. A direction
printed on any member applies to the group, including a held/cue member. If an
invalid group supplies conflicting arrows, the first explicit direction in
staff/voice/head order wins consistently for playback and engraving.

## Engraving hints

`unbroken` is `null` when omitted, `true` for yes and `false` for no. It is not a
playback switch. Shared number/onset groups can span staves without the hint,
as permitted by MusicXML. Omitted or yes draws one wave across visible members;
explicit no draws separate staff waves while retaining one playback roll.
If yes/no hints conflict, explicit no conservatively breaks the displayed line.
Every participating beat reserves pre-note space, and only its first visible
member beat paints a common wave. Hidden staves are excluded from visual bounds.
Existing MusicXML relative-position attributes are not newly interpreted by
this change; normal pre-note spacing determines the wave's horizontal position.

## Playback policy and bounds

Source notation specifies pitch order, not milliseconds. The engine uses the
existing AlphaTex arpeggio fraction: shortest member beat duration divided by
the count of distinct sounding pitches, spread evenly across those pitches.
The span is bounded by each member's sounding duration. Equal-pitch heads share
an onset. Cue notes and continuations whose tie origin sounds on the active
repeat traversal do not retrigger or consume roll positions. Conditional ties
remain governed by the generator's existing eligibility rules.

Attack offsets shorten the corresponding sounding duration so existing note-off
and tie-tail endpoints remain fixed. A final per-note bound also prevents an
offset crossing a swung or otherwise shortened performed endpoint. Pitch,
velocity, channel, timeline bounds and other event fields remain unchanged.
The existing per-note neutral bend reset follows its delayed attack; that tick
change is part of the expected MIDI difference, not a new pitch bend.

## Verification boundary

The source tests cover both directions and default no-arrow notation,
single/multiple staves, separate numbers, explicit membership, unbroken tri-state,
unisons, short notes, held ties, cue notes, JSON and clone round trips, and both
SVG layouts. Synthetic five- and four-head shapes exercise the same pitch sets
used by source acceptance without committing a real score.

Installed-package official preparation, actual renderer Worker and real-score
acceptance remain release gates. These source tests are not a musical source
certification or a listening test.
