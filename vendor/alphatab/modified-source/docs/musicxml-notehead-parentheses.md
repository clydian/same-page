# MusicXML notehead parentheses and legacy ghost notes

MusicXML `notehead parentheses="yes"` records the appearance of a notehead. The
[MusicXML 4.0 notehead reference](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/notehead/)
defines omitted `parentheses` as `no`; it supplies no ghost, optional, ossia,
divisi, velocity or duration instruction. The importer therefore writes
`Note.isNoteHeadParenthesized`, independently from `Note.isGhost`.

Standard notation and tablature retain the existing parentheses glyph/layout by
accepting either flag. Only the legacy `isGhost` flag affects MIDI velocity.
Pitch, attacks, releases, dynamics, timing and tempo remain identical when only
the MusicXML appearance attribute changes. Both flags may coexist without
painting duplicate parentheses; the explicit ghost effect still applies.

The new boolean defaults to false and is retained by generated typed JSON,
structured Worker serialization and `NoteCloner`. Old JSON without the field
continues to work. Old `isGhost: true` data and AlphaTex `{g}` retain their existing
display and quieter playback. JSON carrying only `isGhost` cannot reveal whether
it once came from MusicXML or a genuine ghost note; do not infer provenance or
silently reinterpret that data. Reimporting MusicXML uses the appearance flag.
There is no storage migration or new AlphaTex syntax.

The bounded regression covers omitted/no/yes, explicit-mf MIDI, standard and
tablature Page/Horizontal appearance, an upper-only parenthesized chord head,
typed JSON/deep clone, and legacy ghost behavior. Real S44 is an isolated
validation fixture only: its upper Ab5 parentheses do not authorize removing,
muting or changing the note. Source-score publication is a separate action.
