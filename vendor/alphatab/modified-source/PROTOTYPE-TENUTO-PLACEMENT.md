# MusicXML tenuto placement

Same Page issue #499: a source tenuto above a high piano note was placed below
its head near ledger lines. The MusicXML was correct; importing `above` and
`below` previously produced the same native model and SVG.

`Note.tenutoPlacement` and the public `TenutoPlacement` enum preserve an explicit
MusicXML tenuto side through generated note clones and score JSON/Worker
roundtrips. Old JSON and omitted or unknown placement use `Automatic`, retaining
the existing stem-dependent engraving. This property only applies when the
note's accentuation is `Tenuto`; it does not change accents, staccato, ties or
phrase slurs.

The renderer uses the same side decision for the effect band and the font glyph.
A chord emits one tenuto per requested side, so two explicitly opposite sides
remain independent; repeated tenutos on the same side share a glyph. Separate
voices, staves and parts keep their own glyphs. This does not add multiple tenuto
instances to one note or support MusicXML default-x/default-y or Bezier controls.
No pitch, rhythm or MIDI performance parameter is changed.

Owned regression tests are in
`packages/alphatab/test/rendering/MusicXmlTenutoPlacement.test.ts` and cover actual
Page/Horizontal SVG rendering, stem directions, chords, simultaneous voices,
staves, generated clone/JSON compatibility and unchanged other-articulation
behavior. Real score sources and output evidence remain outside this source
repository.
