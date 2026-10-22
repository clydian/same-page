# MusicXML accent and tenuto coexistence

This source change fixes a pre-existing native13/native14 loss: MusicXML `accent`
(or `strong-accent`) and `tenuto` previously overwrote the same enum, so sibling
order selected both the visible symbol and playback velocity.

`Note.isTenuto` is independent of `Note.accentuated`. The MusicXML importer records
both marks, leaving `Normal` or `Heavy` in the accent enum and `isTenuto=true`.
A tenuto alone retains the old `AccentuationType.Tenuto` value. Generated JSON and
deep clones preserve the boolean; missing old fields default to false, and legacy
`Tenuto=3` still draws a tenuto. Enum numeric values are unchanged and are not flags.

Score notation draws distinct glyphs. Tenuto retains existing explicit placement;
accent retains existing automatic stem-relative placement. On the same side,
tenuto is stacked nearer the note than accent, using the existing effect layout.
Chord notes deduplicate one symbol of each kind per side. This does not add accent
placement support or change source MusicXML bytes.

MIDI needs no new rule: `Normal`/`Heavy` keeps its existing single velocity
adjustment. Tenuto adds no duration, tempo, or velocity adjustment. Equivalent dual
XML orders therefore have identical glyphs and MIDI. Existing single-mark behavior
is preserved. No AlphaTex/GP interchange extension or arbitrary articulation list
is implemented by this bounded change; those formats must not be used to certify
a dual-mark roundtrip.

`MusicXmlDualArticulations.test.ts` exercises both orders, strong accents, Worker
structured JSON, generated clones, missing-field legacy data, both score layouts,
stems/sides, actual SMuFL non-overlap, chord deduplication, adjacent unmarked notes,
and actual MIDI event/timing equality to the corresponding single accent.

MusicXML 4.0 defines articulations as zero or more child marks, including distinct
accent and tenuto symbols:
https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/articulations/
