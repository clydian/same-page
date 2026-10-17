# Chorus Player 0.1.7 (transposed ties)

Base: exact 0.1.6 source recipe in `chorus-player-0.1.6.md`.
Apply `patches/chorus-player-0.1.7-transposed-ties.patch`, set the player
package version to 0.1.7, and build/pack with Node 24.

alphaTab 1.8.4 matches unnumbered MusicXML tie stops before instrument
transposition against starts that have already been transposed. Two consecutive
four-beat tied pairs, written D4 then C4 for a B-flat instrument, can therefore
connect the second pair to the first, changing both pitch and sustained time.

The engine assigns explicit IDs to complete unnumbered chains in its temporary
score-partwise import input. A chain is matched by written pitch, staff, voice and adjacent score time;
existing IDs are reserved, and stop precedes start on continuation notes. Pitch,
rhythm, lyrics and original uploaded bytes are preserved. Nontransposing scores,
unmatched endpoints and ambiguous chains retain their existing input. Cross-voice
or cross-staff unnumbered ties are not inferred by this compatibility repair.

Tests load the actual bundled player and generate MIDI: adjacent transposed
chains, start-before-stop continuations, chord ties and equal pitches in separate
voices. Source tests also cover reserved explicit IDs, incomplete chains and
unchanged nontransposing bytes, interrupted chains, ambiguous unison starts and changed divisions. The real transcription example is separately
checked for correct adjacent tie origins and preserved decoded note events.

All prior dist files except engine.js are byte-identical to 0.1.6; this artifact
adds musicxml-transposed-ties.js and its declaration. Public APIs, stored
preferences, user attachments and access rules are unchanged. This is a bundled
artifact, not an upstream package publication. Tracked by issue #442.
