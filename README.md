# MusicXML lyric readability evidence

Baseline: clydian/same-page main 0e37d01a59850daa322ade4a35b532dbe432b790.
Change: lyric font 12 -> 16 native units; stretchForce 1 -> 1.5.

Real Chromium screenshots of the existing createPlayerSession rendered SVG, using
one synthetic 8-measure MusicXML score with Chinese and English verses and eight
eighth notes per measure. Same score, viewport heights 900, widths 1024/390,
deviceScaleFactor 1, notationScale 0.6, locale zh-CN. Session reached ready.
No CSS font enlargement, image processing, crop, or screenshot assertions.
All four final images were opened and inspected by the implementing agent.
This is the real player session renderer in a minimal harness, not the full
product shell and not a physical device/Safari/PWA validation.

After increasing only the lyric font, dense lyrics crowded on the desktop's
ragged last system. The existing native stretchForce was then raised to 1.5;
final systems and mobile two-verse lanes were inspected. Font family, italic
style and normal weight remain unchanged. More horizontal space can mean fewer
bars per system for all MusicXML scores; notes themselves retain size and content.
No claim of arbitrary-score collision freedom: native lyric horizontal spacing
is not fully driven by measured text widths.

Reproduce: npm ci in the product checkout. Copy fixture.html to lyrics-review.html
at its root; adapt the absolute checkout paths in capture.mjs and vite.config.mjs.
Expose alphaTab's dist/font and dist/soundfont directories as /font and /soundfont
(or temporary symlinks at the repository root). Run Vite with this config; run
capture.mjs before/after at the baseline/change revisions. Remove harness and
symlinks afterwards. No fixture or PNG belongs in the product branch.
