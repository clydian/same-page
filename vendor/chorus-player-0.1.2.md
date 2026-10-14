# Chorus Player 0.1.2 (Same Page solfege patch)

Base: `clydian/chorus-score-studio` commit `7ed4a3b` (0.1.1).
This artifact adds `PlayerSession.solfege(boolean)` and optional `PlayerState.solfege`.
It reuses the existing `solfege-degree` algorithm and Chorus note-head anchoring,
rebuilding labels on `renderFinished` and removing them on toggle/dispose.
No source, playback position, mix, authorization, or stored preference changes.
Labels follow each bar's key signature; minor uses la-based 6 as in Chorus.
The preference lasts for the current player session. Host CSS styles the overlay.

Reproduce in an isolated checkout of the base commit:

1. Apply `patches/chorus-player-0.1.2-solfege.patch` at the Chorus repository root.
2. Set `packages/player/package.json` version to `0.1.2`.
3. With TypeScript 6, add `rootDir: "src"` to that package's `tsconfig.json`.
4. Build with `tsc -p packages/player/tsconfig.json` and pack that package.

Built using Node 24.21.0 / TypeScript 6.0.3. The tarball and lockfile are pinned;
production does not access an adjacent checkout or the Chorus service.
