# Chorus Player 0.1.3 (notation repair)

Base: clydian/chorus-score-studio commit 7ed4a3b (0.1.1).
Apply patches/chorus-player-0.1.3-notation.patch instead of the 0.1.2 patch.
Set packages/player/package.json version to 0.1.3 and tsconfig rootDir to src,
then build with TypeScript 6 and pack. Built with Node 24.21.0.

- Secondary voices use opaque black notation; playback highlighting remains host-owned.
- Clear numeric labels on renderStarted and rebuild on postRenderFinished:
  alphaTab's worker publishes the new bounds only after renderFinished.
- solfege(visible, part?) selects one track independently of playback focus/mix.
  Default is the first track. Selecting another track changes notation only.
- Existing boolean solfege calls remain compatible. No persistent data changes.
