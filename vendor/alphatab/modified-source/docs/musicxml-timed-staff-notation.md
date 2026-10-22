# MusicXML timed staff notation prototype

MusicXML attributes apply in musical score order, including when another voice is
read after a backup. A bar's existing `clef`, `clefOttava`, `keySignature` and
`keySignatureType` remain its initial context. `Bar.notationChanges` holds later
changes in bar-local display ticks (960 ticks per quarter), including the bar end.
The next bar inherits the final context. JSON/Worker serialization preserves the
list; omitted lists retain the previous whole-bar behavior.

Standard notation resolves each head's staff position and accidental context at
its own beat time. Clef changes retain accidental carry by written pitch; key
changes start a new accidental scope. The renderer reserves an independent
spacing spring for a change inside a held note. No musical beat, rest, duration,
pitch, or playback event is added. Bar-end symbols occupy the pre-barline area.

The current timed import scope is pitched G2, F4, C3 and C4 clefs, octave changes
-2 through 2, traditional integer fifths -7 through 7, numbered staff keys or
unnumbered keys on every declared staff, explicit key cancellation, and
`print-object="no"` for a timed glyph. Hidden changes still change the subsequent
notation context. Additional/cue clefs, other clef lines, TAB and percussion
changes, and nontraditional key signatures are conservatively left unsupported;
they must not turn into an invented default treble clef. This does not add timed
meter/transpose/staff-detail support. Numbered-notation key labels and custom
engraving size/position attributes remain outside this standard-staff prototype.

The owned tests use inline MusicXML, real Page/Horizontal SVG, JSON round trips,
and every MIDI field/bar bound. Copyrighted score evidence is kept outside the
repository. Actual Arirang checks additionally cover end-of-bar 8/9 clefs,
bar 29's internal clef change, and bar 50's end-key cancellation. A model round
trip is not by itself evidence that a real browser renderer Worker loaded it;
the latter is a separate integration gate before packaging.

Primary references:
- https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/attributes/
- https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/clef/
- https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/key/
