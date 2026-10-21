# Measured single-note tremolo rate

A single tremolo mark denotes a subdivision, rather than a fixed count of
repetitions per printed note. Two strokes on a quarter, half or whole note
therefore produce sixteenths: 4, 8 or 16 attacks respectively. Existing flags
and beams add to the number of subdivision levels on shorter notes. Dots
extend the total span without stretching each stroke; an actual tuplet still
scales that subdivision. The public duration helper and native MIDI generator
apply the same base-quarter rule. Paired tremolo's separate timing path is
unchanged.

Owned tests import MusicXML through the real importer, round-trip its public
JSON, and assert physical NoteOn ticks for long notes, attached flags, dots
and a genuine tuplet. Two older dotted-tremolo audio snapshots are corrected
from stretched strokes to the same total span with additional subdivisions.
No source XML or printed duration is expanded or rewritten.

Tie chains, especially a roll ending in an unmarked tied note, require a
separate bounded performance interpretation and are not certified by the
rate correction alone. Unmeasured rolls, slides/bends and fermata seconds
are also outside this initial rate fix.

Primary references:
- https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/tremolo/
- https://handbook.musescore.org/notation/expressive-markings/tremolos-and-rolls

## Plain tie-chain performance boundary

Each explicitly rolled beat generates only its own span, with its own dynamic
and marks. An explicit roll on the next tied beat starts its own subdivisions;
we do not simultaneously run an earlier origin's roll over that later beat.
When the next tied note has no roll, only the last stroke sustains into that
plain destination (and any following plain tied notes), rather than creating
fresh attacks inside an unmarked destination. An untied destination remains a
new attack. This is a bounded reference performance interpretation of the
source tie: the XML, printed tremolo and written timing remain unchanged.

A bend, slide, trill or ornament on a plain destination retains the legacy
chain-duration fallback. This change does not certify an ordinary held note
entering a later roll, guitar slides/bends, grace endpoints, fermata length,
or expressive attack timing. Those combinations need separate fixtures and
musical adjudication. The adjacent paired-tremolo path remains unchanged.

A rolled origin with a bend, whammy bar or incoming/outgoing slide also keeps
its legacy tie/slide span. An actual quarter-note legato-slide control showed
that applying the plain boundary to such an origin would truncate eight
existing strokes to four. This guard restores that existing boundary without
claiming a newly correct slide/bend performance model; the independent measured
rate correction still applies. Owned legato-slide and bent-tie-origin controls
exercise the real public model and JSON path.
