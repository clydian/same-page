# Typed source lyrics: reviewable prototype

This isolated checkout is based on the official alphaTab v1.8.4 release, peeled
commit `022a45c8e42370f9e12e68949d11eada370da83d`. It is not a dependency release.
The Same Page host, Chorus source and installed packages have not been changed.

Upstream develop `2fb351d56ccc29809ecfffb2f48301fd0ebda5ba` still ignores MusicXML
syllabic and extend; its LyricsGlyph remains a text-only glyph. Issue #2908 asks
for exposing lyrics editing, and #2760 fixes tie-destination word assignment;
neither supplies typed source melisma layout. The existing project pins official
npm `@coderline/alphatab:1.8.4`; no alphaTab fork maintenance mechanism was found.
See https://github.com/CoderLine/alphaTab/issues/2908 and
https://github.com/CoderLine/alphaTab/pull/2760 .

The prototype introduces a serializable `LyricElement` per verse, preserving the
legacy `Beat.lyrics` text. The importer retains syllabic and extension events.
The native LyricsGlyph reserves its own lyric line height, measures actual text,
and draws lines inside its existing effect lane using the native canvas. It
splits the line using current native staff/system renderers. No SVG overlay,
private runtime patch, source XML rewrite or underscore text is involved.

From the repository root:

```
npm ci --ignore-scripts
npm run generate-typescript --workspace packages/alphatab
npm test --workspace packages/alphatab -- test/rendering/TypedLyrics.test.ts test/model/Lyrics.test.ts
npm run typecheck --workspace packages/alphatab
```

The original four owned tests fail on the baseline release. Eleven owned tests
now cover typed source semantics, worker JSON serialization, actual SVG geometry,
missing redundant continue events, no inference from pitch ties/slurs, ordinary
hyphens, continuous segment joining, legacy extenders ending before a new word,
basic two-verse lanes, stop-note coverage, and actual system breaks. The nine existing lyric model tests also pass.
The narrow fixture is three source measures with a same-pitch tied word, an
unequal-pitch slurred word, and a two-syllable word. Native before/after MIDI
is byte-for-byte equivalent at the event-object level in the saved proof.

Not production acceptance:

- Stop geometry extends toward the following lyric/rest boundary, clearing the
  next printed text. This is an explicit re-engraving policy, not measured source
  horizontal timing. Source exact positioning and style still need review.
- Complex verse/elision formatting, print-object/no, placement/default-y and
  mixed font/style are not yet represented in LyricElement.
- Hyphens spanning rests, skipped beats and system breaks need separate layout;
  the prototype only draws between adjacent text-bearing beats in one system.
- Cross-voice divisi/shared lyrics, cross-staff lyrics, multitrack selection,
  partial redraw/worker layout and all-score collision cases need owned tests.
- Backward scanning of earlier lyric states is intentionally simple; indexing
  should replace repeated scans before large-score performance acceptance.
- Only ESM/native SVG and TypeScript code generation were exercised. C#/Kotlin
  generation, full importer/visual corpus and browser integration were not.

A supported production path is a maintained source-level alphaTab contribution
with tests, preferably upstream. If an internal fork is required while upstream
review runs, establish explicit repository ownership, MPL source/notice retention,
CI, versioned immutable artifacts and lockfile provenance before integration.
Do not ship this unversioned build as official 1.8.4 or silently patch node_modules.

Browser verification found that glyph ink height is not a stable lyric-lane height:
a space has zero ink height, so continuation segments used to jump above the word.
Each verse now reserves the font's line size and uses that same baseline for text
and blank continuation beats. An owned test reproduces browser-like zero-height
spaces before the fix. The Node SVG font fallback still estimates every character
at a uniform width; it can suppress a syllabic hyphen in a crowded interval even
when actual browser font measurement renders it correctly. Full-score visual
acceptance therefore requires the real browser/BrowserUiFacade, not Node SVG only.

A syllabic begin/middle whose following syllable is on the next system retains a
native hyphen in the trailing space of the first system. The owned two-bar test
fails without that geometry and passes after it. It does not introduce a second
literal dash character into the source lyric text or change MIDI.

The 25b027f Finzi evidence did not cover syllabic spans over blank-lyric notes:
Tenor/Bass bar 4 `No` → untexted note → `thing` had no native hyphen. The follow-up
branch finds the next printed lyric in the same verse and voice, keeping the dash
through intermediate notes and blank-lyric systems. Owned same-system and
three-system fixtures reproduce the omissions before the fix. This deliberately
does not infer a transition across independent voices; that requires source lane
identity beyond a bare extender. Prior full-score word-retention/MIDI evidence
remains valid but was insufficient to claim complete underlay rendering.

Previous-beat scans remain an identified performance concern for long scores;
this correctness prototype has not optimized or benchmarked their complexity.

Placement follow-up (branch codex/typed-lyrics-placement): MusicXML above/below is
retained as LyricElement.placement (default Below), including Worker JSON and
Beat cloning. Above uses a distinct native lyric effect band above standard
notation; Below keeps the legacy renderer route. Verse indices remain source
indices while each side compacts its own displayed lines, so source verse 2 above
does not create a phantom verse-1 line on that side. The native visibility setting
hides both sides. This change does not resolve source lyric-lane transfers between
voices/verse numbers or invent an endpoint for a legacy bare extender. In Even
55/56 the upper I/be placement can be tested separately from its cross-lane
continuation to the following shared word; the latter remains unaccepted.
