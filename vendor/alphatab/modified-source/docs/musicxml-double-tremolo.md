# MusicXML paired tremolo prototype

`TremoloPickingEffect.type` preserves Single (the compatibility default), Start,
and Stop. A derived `Beat.doubleTremoloPartner` resolves adjacent Start/Stop
endpoints in the same native voice/bar with equal printed type, dots, ratio,
marks and style. It never stores stale beat IDs, invents notes, or joins another
voice/staff/bar. JSON and generated clone retain the primitive role; normal
score finishing rebuilds the beat adjacency. Old JSON without `type` remains
Single. Unmatched or unsupported endpoints remain typed but unpaired and play
ordinary authored notes, rather than fabricated alternation or single-picking.

For a paired group, both original beats and their written type/dots/time ratio
remain intact. Every note in the first group receives even strokes over the
combined span; every note in the second receives odd strokes. The stroke rate
counts normal attached beams plus authored tremolo marks. Dots extend the span,
not each stroke. The mandatory MusicXML 2:1 duration component is removed from
stroke speed; a surrounding tuplet still scales it. A second group's per-note
pitch initialization is placed at its first physical attack, not at the later
endpoint's written onset. Repeated NoteOn/Off are performed by the native MIDI
generator; the MusicXML is not expanded or rewritten.

Standard notation joins the two stems with native filled beam polygons. It
suppresses the separate single-note tremolo glyphs and suppresses only the 2:1
encoding component of the tuplet label, retaining a genuine outer tuplet.
Automatic stem directions are calculated for both groups together. Authored stem
preferences retain priority. Source roles and original duration remain visible
in the public model and Worker serialization.

The initial target is measured paired tremolo on pitched standard notation,
with native-supported stroke counts (1–5), equal adjacent groups in one bar and
one staff/voice. Cross-staff/bar continuation, unequal groups, rests/grace notes,
unmeasured alternating tremolo, separately authored opposing stem directions,
whole-note floating strokes, tab/slash notation, and combinations with note
bends/slides/tie chains have not been certified by this prototype. Do not treat
an unverified combination as source acceptance. The older Single path and its
playback convention are preserved.

Owned tests use synthetic original fixtures, explicit alternating controls,
actual NoteOn/Off ticks/releases, JSON/clone, nested 3:2 × 2:1, attached beams,
Page/Horizontal paths and a second-group pitch initialization boundary. Real
Arirang 70 and browser Worker tests are kept as separate evidence outside the
repository. No listening or full source certification is implied by MIDI parity.

Primary reference:
https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/tremolo/
