# Same Page MusicXML cue and hidden-rest support

This patch retains timed pitched `<cue/>` notes as `Note.isCue` in the model.
They keep ordinary score time and engraving, but generate no note or note-effect
MIDI. `<type size="cue">` controls small notation independently: a small note
without `<cue/>` still sounds, and a cue with `size="full"` remains silent.
`Note.isSmall`, `Note.isCue`, and `Beat.isRestVisible` survive JSON serialization
and cloning; omitted fields keep the previous ordinary-note/visible-rest defaults.
Visual ties to/from cues remain available to engraving, but cannot extend an
ordinary sounding note or suppress its attack.

A rest note with `print-object="no"` keeps rhythmic layout, duration, navigation,
and any separate direction marks. Only its rest/dot ink is suppressed, including
slash rendering. A hidden rest cannot hide a coincident visible rest. The source
MusicXML is never rewritten by this native importer. A wrapper may separately
normalize `<forward>` to an invisible rest; this module does not invent source
rest content or interpret a source annotation as a mandatory alternate passage.

Timed small heads participate in shared multi-voice layout. Each head's own scale
is used for its SMuFL stem attachment. Opposing-stem small/ordinary heads must have
separate ink. Same-direction heads may meet only inside the font's shared-stem
attachment band; requiring disjoint bounding rectangles (or disjoint ink even at
that common stem) is an overly strong engraving criterion. Regression tests use
the repository's Bravura font, actual painted SVG positions, isolated raster ink,
and an intentionally coincident control. No arbitrary spacing gap is introduced.

Scope: this is pitched timed-cue and hidden-rest support, not a general cue-layout
engine. Cue boxes, source-relative x/y offsets, arbitrary optional-performance
semantics, cue-rest sizing, and orchestral cue-label conventions are not recreated.
The two-note boxed reference in Zhou piano 22 is a separately documented editorial
silent display choice, not evidence that these notes must be played.
