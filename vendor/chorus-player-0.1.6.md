# Chorus Player 0.1.6 (repeat endings)

Base: the exact 0.1.5 source recipe in `chorus-player-0.1.5.md`.
Apply `patches/chorus-player-0.1.6-repeat-endings.patch` to that source,
set package version to 0.1.6 and build/pack with Node 24.

alphaTab 1.8.4 clears global alternate-ending flags while importing later
parts. A bracket written only on the top staff can therefore play its first
ending again on the second pass. This was reproduced against the deployed
0.1.5 artifact with the source for *If ye love me*.

The shared engine now mirrors ending endpoints across parts in its disposable
prepared MusicXML input. Original uploaded bytes, pitches, durations and
per-part bar styles are retained. Single-part scores and scores without
endings keep the existing path. The scope is score-partwise MusicXML.

Regression tests generate actual MIDI playback sequences: endpoints on the
first part, last part, all parts, ordinary repeats and a multi-measure ending.
The original source's 27-measure example now plays 1–26, 14–25, 27; its first
ending (26) occurs only on the first pass.

All existing dist files except engine.js are byte-identical to 0.1.5; the new
repeat-endings module and its declaration are added. Public APIs and persisted
practice preferences are unchanged. This is a bundled artifact, not an upstream
package publication.
