# Chorus Player 0.1.4 (notation repair and annotation scope)

Base: clydian/chorus-score-studio commit 7ed4a3b (0.1.1).
Apply patches/chorus-player-0.1.4-notation.patch instead of the 0.1.2 patch.
Set packages/player/package.json version to 0.1.4 and tsconfig rootDir to src,
then build with TypeScript 6 and pack. Built with Node 24.21.0.

- Secondary voices use opaque black notation; playback highlighting remains host-owned.
- Clear numeric labels on renderStarted and rebuild on postRenderFinished:
  alphaTab's worker publishes the new bounds only after renderFinished.
- solfege(visible, part?) accepts a track index or null for all tracks.
  Omitting part preserves the current scope; first use defaults to the first track.
  Selecting a scope changes notation only, independently of playback focus/mix.
- Existing boolean solfege calls remain compatible. No persistent data changes.
