# Chorus Player 0.1.8 (explicit tie ID reuse)

Base: exact 0.1.7 source recipe in `chorus-player-0.1.7.md`.
Apply `patches/chorus-player-0.1.8-explicit-ties.patch`, set the player
package version to 0.1.8, and build/pack with Node 24. Run
`node --experimental-strip-types --test tests/musicxml-transposed-ties.test.mjs`
for the 16 source regressions. SamePage's
`musicxml-transposed-ties.node.test.ts` loads the actual bundled artifact.

alphaTab 1.8.4 stores explicit MusicXML tie starts by staff and number. XML
voice order can start another chain with that number before the old stop is
read. The stop then adopts the wrong origin and even its pitch. Issue #448's
three-bar E4/F4 example produced three four-quarter notes instead of two
eight-quarter sustained notes.

The temporary import-input normalizer now proves complete pairs using original
number, written pitch, staff, voice and adjacent musical time, then allocates
IDs 1–16 using their XML document intervals. Stop-before-start ordering handles
continuations. This extends the existing transposed unnumbered-tie repair to
explicit ties in all parts. No model pitch patches or attachment rewrites occur.
The internal helper keeps its historical `normalizeMusicXmlTransposedTies` name.

Cross-voice/staff endpoints, duplicate simultaneous starts/stops, incomplete
pairs unsupported tied types and polymetric declarations are not inferred. Their explicit IDs are
reserved. If the remaining ID budget cannot cover a part, that part retains
its original input. Ordinary partial bars retain the meter's silent remainder;
the opening pickup and explicitly implicit bars use their actual duration.
These are conservative compatibility boundaries, not promises to repair every
unsupported or ambiguous score. Uploaded source bytes remain unchanged.

The actual bundled importer and MIDI generator restore E4 and F4 to 8 quarters
each in the reproduction. Existing source regressions cover transposition,
chords, independent voices, continuation order and changed divisions. New
regressions cover explicit reuse, unsafe endpoints, reserved IDs, budget
exhaustion and silent bar remainders.

All 23 published first-round candidates plus the current 80-bar If Music piano
reconstruction were imported with 0.1.7 and this artifact, and actual MIDI was
generated for both. All 24 have byte-for-byte equal decoded event ledgers and
MIDI event arrays across versions. Each repaired model also matches an untied
control's pitch/time ledger. Input hashes, counts and MIDI digests are recorded
in `checks/chorus-player-0.1.8-corpus.json`. This is playback regression evidence;
it does not certify those candidates' source correctness or final acceptance.

All packaged dist files except `musicxml-transposed-ties.js` and its declaration
are byte-identical to 0.1.7. Public APIs, storage and access boundaries remain
unchanged. This bundled artifact is not an upstream package publication.
