# MusicXML chord staccato playback

A principal note's explicit staccato applies to the common chord attack during playback. The importer records this shared scope only when a following `chord` note actually joins that beat. It retains the original note-level articulation for engraving, so the source still draws one mark.

`Beat.sourceChordStaccato` defaults to false and survives generated cloning and Worker JSON. A secondary-note-only staccato, another voice, and legacy model/JSON data retain their note-specific behavior. The existing duration reduction is unchanged; this does not define a new performance ratio for combined tenuto/staccato.

An explicit tie chain on a secondary chord member takes precedence over the shared articulation: its held duration and lack of a new attack survive. Untied members still shorten. Explicit note-level staccato keeps the native policy for that note.

Regression coverage uses owned MusicXML, actual MIDI note releases after JSON round-trip, independent-voice and legacy controls, and an actual SVG glyph count. Source MusicXML need not duplicate visible articulations across chord members. Formal packaged Worker and real-score validation remain separate release gates.
