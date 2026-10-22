# MusicXML stem visibility

`<stem>none</stem>` is retained as `Beat.isStemVisible = false` through generated cloning and public JSON/Worker transport. Missing fields in older JSON and other import formats default to `true`. Unknown stem values retain automatic engraving.

The standard-notation renderer omits only the stem rectangle. Noteheads, written duration, MIDI, beam/flag/tuplet glyphs and the existing spacing/beam calculations are unchanged. This avoids converting stemless proportional/free notation into a different rhythm or silently removing separately printed rhythmic graphics. Layout can therefore retain normal stem clearance; this is not a new free-time spacing engine.

The native beat represents one shared stem for its chord. An explicit `none` on any chord member suppresses that shared stem, without affecting other beats, voices or staves. It does not add independent conflicting stems inside one chord, cross-staff beam reconstruction, stem length controls or tablature/slash-staff stem support. Source files with unusual mixed-stem chord semantics need separate source adjudication.

The owned tests compare actual SVG after public JSON, require only stem rectangles to disappear for quarter/half/eighth and chords/beamed groups, and retain all MIDI events and bar bounds. Actual source layouts and real browser Workers remain release gates.
