# Player 0.1.19-samepage.1: practice interaction contract

Base: clydian/chorus-score-studio commit `68934362feef46b24c55372c8c91f813acb97cc1`, the exact 0.1.19 source. This is a SamePage-local artifact, not an upstream publication.

Apply `patches/chorus-player-0.1.19-samepage.1-practice-ux.patch` to the clean base, install its locked dependencies (native peer remains exactly `1.8.4-samepage.2`), build `packages/player` with Node 24 and TypeScript 6.0.3, then `npm pack --ignore-scripts --workspace packages/player` after building. Tarball SHA-256: `8e3fd6f2bfeea80988207c4e71caab6c95a630249f0d003d81b822826c3b2f0c`.

- `suspendFollow()` explicitly suspends viewport following without pausing playback or changing position. `follow()` restores the existing behavior. The host uses the new method before applying a visual transform; it does not synthesize input events to manipulate the engine.
- `seekAt(x, y)` accepts engraving coordinates through alphaTab’s public bounds/tick lookup APIs so magnified taps still seek correctly. The host normalizes CSS-transform coordinates and cancels drag/pinch taps; normal-scale native interaction stays unchanged.
- `playbackMeasureLabels(numbers)` labels every visit of an ambiguous printed number with its occurrence, including the first visit. Pickup, excerpt and alphanumeric numbering alone do not trigger playback-order noise. Session labels, timeline, locator and loop selectors use the same result. User practice looping does not rebuild the source playback path.
- No prepared payload, source XML, native renderer, MIDI, timing, mix or storage format changes. Only session, label helper, their declarations and package version differ from the base artifact. Existing public methods remain compatible.

Installed-package label regression lives in `src/client/playback/playback-measure-labels.node.test.ts`; real Session and follow/zoom integration are covered by `browser-tests/practice-measure-labels.test.mjs` and `practice-reader-layout.test.mjs`. Browser automation is not physical-device gesture or VoiceOver acceptance.
