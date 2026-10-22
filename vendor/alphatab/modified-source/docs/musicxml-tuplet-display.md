# MusicXML tuplet display

An explicit `notations/tuplet` start can set `show-number="none|actual|both"` and `bracket="yes|no"`. These affect display only. `time-modification` continues to determine note durations, MIDI, and the common timeline.

The imported declaration belongs to the beat starting the rendered tuplet group. The optional `Beat.sourceTupletNumber` and `Beat.sourceTupletBracket` fields survive generated clones and the public JSON/Worker boundary. Missing declarations and old JSON retain automatic engraving. Unknown attribute values are ignored. The display flags never create a tuplet or change its ratio.

For a complete native tuplet group, `none` suppresses the number, `actual` shows the numerator, and `both` shows the ratio. `bracket="no"` suppresses the bracket independently. A bracket with no number has no artificial gap. Existing automatic grouping remains in place; this does not add MusicXML nested-span, cross-bar, separate placement, show-type, or custom tuplet-number support. Explicit bracket requests on incomplete native groups retain that renderer's existing number-only fallback.

Source transcription must distinguish printed tuplets from ratios introduced for a deterministic practice grid. Only hide an editorial ratio when the original score and the recorded editorial policy support it. Do not remove timing ratios or hide genuine printed tuplets to make a screenshot match.

The regression fixture exercises both flags separately and together, explicit ratio display, a following ordinary group, public JSON roundtrip, and exact MIDI/boundary preservation. Recheck actual source scores in both Page and Horizontal layouts before packaging a release.
