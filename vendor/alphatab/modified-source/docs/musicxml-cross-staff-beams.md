# Explicit MusicXML cross-staff beams

MusicXML's `voice` can continue onto another staff. Native `Voice` objects remain
staff-local for playback and ordinary layout. `Beat.sourceBeamGroup` preserves a
complete authored beam group's identity independently of those local objects;
public JSON and native clones retain it together with the explicit member index
and complete group size. Repeated cloned groups are separated by those source
indices, rather than joined merely because a clone retained the same ID. It does not change notes, rests, timing,
voice ownership, pitches or playback. Zero (including old Worker JSON with the
field absent) retains the previous staff-local behavior.

The importer assigns nonzero IDs only for a contiguous, complete
`begin`/`continue`/`end` sequence in one part and logical MusicXML voice which
actually crosses staves. This first implementation supports equal printed
values/dots, equally numbered complete beam levels, and one explicit common
stem direction. Different voices, missing endpoints, timing gaps, mixed stem
directions, secondary hooks/mixed levels, grace/cue notes and rests retain their
existing path. In particular, it never joins notes by visual proximity or by the
coincidental local voice index on two staves.

Supported groups use a shared beam line derived from their actual stem anchors.
Staff-local helpers stop at their group boundaries, so returning to a staff does
not reconnect different source groups. Each system paints only its own members;
it does not draw a diagonal between separate systems. A singleton system fragment
uses short continuation beams. Full editorial control of continuation lengths,
beam slopes, mixed-stem cross-staff engraving and cross-staff secondary hooks is
outside this implementation. Final system padding reserves only actual outer ink,
after all staff positions are known, rather than counting another staff's height
as local overflow.

The owned rendering regression covers the missing staff-change interval, two
returning groups, distinct source voices, same-staff controls, JSON/clone/old JSON,
up/down system fragments and unsupported-input fallback. Real score and corpus
checks are additional evidence, not a substitute for source reading. An eight-note
phrase slur does not imply one eight-note beam group: the Wang bar 35 source has
two four-note beam groups per half and the source XML is retained unchanged.
