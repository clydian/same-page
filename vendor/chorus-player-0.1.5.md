# Chorus Player 0.1.5 (notation reflow)

Base: clydian/chorus-score-studio commit `7ed4a3b` (0.1.1).
Apply `patches/chorus-player-0.1.4-notation.patch`, then
`patches/chorus-player-0.1.5-reflow.patch` to `packages/player/src/session.ts`.
Set `packages/player/package.json` version to `0.1.5` and tsconfig `rootDir`
to `src`, build with TypeScript 6 and Node 24, then `npm pack`.

- `PlayerState.notationScale` and `PlayerSession.notationScale(value)` expose
  real alphaTab reflow, initially 0.6, bounded to 0.3–1.2 in 0.1 steps.
- Clear source print-system/page breaks on the in-memory score model so reflow uses the viewport. Original XML bytes remain unchanged.
- Scale updates call alphaTab `updateSettings()` then `render()`; no CSS transform,
  new audio session, playback-position update, or mix change.
- After post-render bounds arrive, rebuild numeric labels and restore the first
  visible system for suspended follow. While following, keep the playback cursor
  visible; the initial paused first measure retains the score's heading.
- Preserve source MusicXML measure labels independently of repeat-expanded playback order.
  Labels append playback order only when it differs from the source measure number.
  For nonstandard numbering (pickup 0, excerpts, repeated labels), replace alphaTab's ordinal glyphs using post-render bounds so score and controls agree.
- Numeric annotation font size and gap follow notation scale (5px minimum font) so compact layouts do not retain oversized labels.
- First numeric-annotation scope is all tracks (`null`); subsequent toggles
  preserve an explicitly selected scope independently of mix and focus.
- Existing APIs and stored practice preferences retain their formats. This is
  a bundled client artifact, not an upstream package publication.

API references: [scale](https://docs.alphatab.net/docs/reference/settings/display/scale),
[updateSettings](https://www.alphatab.net/docs/reference/api/updatesettings/).
