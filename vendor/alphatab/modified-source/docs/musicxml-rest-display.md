# MusicXML authored rest position

Tracks [Same Page #559](https://github.com/clydian/same-page/issues/559).

MusicXML [`rest`](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/rest/)
may contain `display-step` and `display-octave`. These place the rest with the
current clef without assigning it a sounding pitch. A percussion clef uses the
treble-clef interpretation, as specified by
[`display-step`](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/display-step/).

Previously the rest branch of `MusicXmlImporter` discarded these children.
The standard-notation renderer then used its automatic duration/voice position.
In the source66 piano case a whole rest explicitly placed on treble E4 was
painted on F5, four staff spaces too high. The source XML was valid; the rest,
its duration and the other voices must remain present.

`Beat.restDisplayStep` now retains a display-only diatonic coordinate (`C0=0`,
seven steps per octave). It is independent of Note, percussion articulations,
key accidentals and sounding transposition. Null retains the entire previous
automatic placement and collision path. The MusicXML importer accepts a complete
valid step/octave pair; incomplete or invalid positions retain the default.

Standard notation resolves this coordinate using `bar.getClefAt(beat.displayStart)`,
and `bar.getClefOttavaAt(beat.displayStart)`, including octave-clef changes inside a bar. Octave clefs shift the diatonic rendering coordinate by 7 or 14 steps; percussion always uses ordinary G4 treble and ignores clef octave. Instrument transpose and separate beat ottava directions do not affect rest display coordinates. The previous native20 interpretation that ignored clef octave was incomplete and is superseded by native22. An authored position reserves its own
collision slot and is not moved or coalesced by the automatic rest solver.
This also keeps separately positioned simultaneous rests visible. Other notation
profiles retain their existing behavior.

Generated Beat cloning and JSON serialization carry the optional coordinate.
Old JSON without the property defaults to null; old readers can ignore it and
retain their previous automatic layout. No existing field is reinterpreted,
and no user data or MusicXML bytes need migration.

Tests use synthetic MusicXML to inspect the actual glyph paint coordinate
relative to the actual staff top, on both page and horizontal layouts. Controls
cover treble/bass/alto/tenor/percussion clefs, a timed clef change, independent
secondary voices, all supported rest durations without coordinates, absent-field
legacy JSON, generated cloning and exact complete MIDI/master-bar bounds.
Geometry alone allows 1e-10 half-staff-step arithmetic noise; raw coordinates
are retained in diagnostic artifacts. MIDI and unpositioned-rest SVG controls
are compared exactly, without time or velocity tolerance.

An optional read-only artifact probe accepts `REST_DISPLAY_SOURCE_XML` and
`REST_DISPLAY_ARTIFACTS` to capture an external score's native MIDI and measures
65–67. It is skipped by the normal test run, contains no real score in the
repository and does not represent prepared-player or listening acceptance.

The initial MusicXML clef `+2` enum is corrected from 15mb to 15ma, matching the timed-clef importer. That fixes this input's notehead display as well as authored rests; pitched `realValue` and complete MIDI remain unchanged. Focused regressions compare literal middle-line oracles for G/F octave clefs ±1/2, actual paint coordinates in both layouts, timed JSON round-trips, percussion exceptions, instrument/beat ottava isolation and complete MIDI. Historical full-suite results do not certify this new revision; final package and full-source gates are recorded separately.
