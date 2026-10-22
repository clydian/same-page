# MusicXML direction brackets: display-only prototype

Related SamePage issue: https://github.com/clydian/same-page/issues/505

This isolated prototype imports matching MusicXML `direction-type/bracket`
start/stop pairs into public `Bar.sourceBrackets` segments. They survive the
normal score JSON/Worker boundary and use native standard-staff layout and
painting. No notes, cursor beats, ornaments, repeats or MIDI events are added.

The supported subset is solid and wavy lines, finite bar-local offsets,
measure-relative default-x, staff-relative default-y, relative coordinates and
none/up/down/both endpoint jogs. Cross-bar spans keep a source identity; visible
system segments do not invent endpoint jogs. A stop exactly at the next bar's
start closes the previous nonempty segment. Fractional-tuplet floating-point
noise is normalized only within 1e-7 ticks of a bar boundary, only for the graphic.

Unsupported continue waypoints, dashed/dotted styles, arrows, explicit colors,
rotations, custom line widths and cross-staff frames are not claimed supported.
Unsupported styles and attributes at either endpoint reject the whole span;
unknown bracket/container formatting also rejects it rather than default-painting.
Color and dash formatting are valid MusicXML but unsupported here. Rotation and
print-object are not schema attributes on bracket/direction/direction-type;
nonstandard instances are also conservatively rejected. Ambiguous repeated starts,
unmatched endpoints and continue chains do not create a fabricated complete
span. The existing importer only reads the first child of each direction-type;
this prototype does not broaden that unrelated importer behavior. A single
frame is currently authored as two finite solid brackets. There is no automatic
collision avoidance or inferred vertical lane. Hand-authored y coordinates can
intersect notes; their suitability must be checked against the actual source.

The wavy form uses ordinary native line geometry. It does not invoke the
MusicXML ornament wavy-line or trill playback. A graphic cannot establish an
unmetered cell's intended duration or repeat count.

Primary references:
- https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/bracket/
- https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/wavy-line/

Owned regression suite: `test/rendering/MusicXmlDirectionBrackets.test.ts`.
Real-score evidence is kept outside this repository; copyrighted score material
is not part of the inline regression fixtures. This is not a packaged release.

Numeric positioning requires complete finite xs:decimal lexical forms. A malformed
prefix such as `20foo`, exponent or hexadecimal syntax, and an empty attribute
reject the complete span; signed decimal forms and surrounding whitespace are
accepted. Numeric rejection does not change the score timing parser.
