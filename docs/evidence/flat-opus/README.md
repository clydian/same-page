# Flat MXL Opus verification

These are actual 390×844 Chromium screenshots of the built application using
isolated local Worker/D1/R2 fixtures. Both short scores are independently
authored synthetic CC0 controls generated in
`browser-tests/opus-playback.test.mjs`; no Bach collection or user score is used.
All three screenshots show the changed application. For the before comparison,
the earlier 1433-byte Opus control was checked against the actual format validator
from main `5f1891c`: it rejected the file with
`当前支持单份 score-partwise 乐谱，请重新导出此格式。` This is a code-level
baseline check, not a screenshot of the old UI.

- [Independent scores](independent-scores.png): SATB, D major, 3/4 followed by
  piano grand staff, C major, 4/4. Internal print breaks are ignored; each score
  starts a new block. Both source measures restart at 1; labels remain unique.
- [Timeline drag](drag-second-score.png): the normal timeline previews 2-1.
- [Local reflow before](local-reflow-before.png) and [after](local-reflow-after.png):
  a 24-score original synthetic book, viewing score 12 at 60% then 70%; notation
  remains bounded to the viewport and the source measure stays at its reading position.
- [Cross-score loop](cross-score-loop.png): range 1-2 through 2-2 and the first
  score's restored Bass solo. The same practice controls serve both scores.

The browser case uploads through the UI and checks real nonzero synthesis,
four-beat count-in, D.C. staying in score 2, click/drag positioning, cross-score
loop return, per-score mixes, reflow, manual browse/follow restoration, inverted
notation colors and clean disposal. The piano pickup is one quarter note. A 24-score book in the same case also checks
bounded SVG, direct distant seeks, manual browsing, reflow anchors and canceling
a loop preview whose target is far outside the mounted notation window, plus
visible notation while the host magnifies the paper.

Local checks: production build/typecheck, 383 player tests, 7 preparation-cache
tests, the Opus browser case and existing single-score rhythm and attachment/PDF
handoff cases passed.
A local 185-score private workload improved fontsize reflow from roughly 15.3 s
to 0.1–0.2 s, and to roughly 0.6 s under fourfold CPU slowdown. This is a rough
desktop comparison, not a device benchmark; no real score files or images are
included here. Global parsing/model/MIDI preparation still grows with input size.
WebKit is not installed in this environment; iOS hardware,
audio continuity at MIDI switches, offline Opus reopening and arbitrary native
MusicXML jump encodings have not been accepted here. PDF handoff retains manual
page positioning, without a MusicXML/PDF coordinate map.
