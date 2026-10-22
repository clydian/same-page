# MusicXML source fermata scope

MusicXML note/rest fermatas belong to their source beat. The old model registered
these on `MasterBar.fermata` and then projected every hold back to all beats at the
same tick. A two-staff measure with a RH fermata at tick 0 and LH fermata at tick
1920 consequently printed a third fermata on the LH alignment rest at tick 0.
This occurs even when the alignment rest is hidden; hiding rest ink is unrelated
to fermata ownership.

`Beat.hasSourceFermataScope` distinguishes source notation from legacy global
fermata notation. `Beat.sourceFermata` holds the explicit source shape/length;
null means no source fermata. MusicXML marks every consolidated beat as scoped,
including generated alignment/empty beats. `Voice.finish` derives its effective
`Beat.fermata` from this source field, while continuing to register the shared
master-bar hold. Source fermatas in secondary voices may render as well.

Both fields survive public JSON and deep Beat cloning. Old JSON lacks them,
defaults to the existing global projection, and needs no migration. Guitar Pro,
alphaTex and other legacy importers retain existing behavior. Multiple source
fermatas at the same tick keep independent notation shapes; the shared hold map
retains its existing one-value-per-tick policy. This change does not invent an
elapsed fermata duration or add MIDI hold performance; existing MIDI events and
hold metadata are retained.

Validation command:

```sh
npm test --workspace=packages/alphatab -- test/importer/MusicXmlFermataScope.test.ts test/importer/MusicXmlImporter.test.ts test/importer/MusicXmlStemVisibility.test.ts test/rendering/MusicXmlCrossStaffSlur.test.ts
npm run typecheck --workspace=packages/alphatab
```

The owned fixture first failed with positions `[[0,0],[1,0],[1,1920]]` instead of
`[[0,0],[1,1920]]` in both direct import and JSON round-trip. Regression coverage
includes Page/Horizontal actual glyph paint counts, legal visible rest fermatas,
different source shapes at one tick, secondary voices, clone isolation, old JSON
projection, shared hold metadata and unchanged MIDI. Importer snapshots add only
the new explicit scope metadata.

A local native build also rendered unchanged If Music candidate SHA256
`f05ef4d0354f739cb9e3e42f329cb8832118e7b739301e39d2e8d91773cf6b4c`.
Full-score layout was used to retain incoming slur context, and the final partial
was captured. Both Page and Horizontal final piano excerpts contain exactly two
fermata glyphs, attached to RH tick 0 and LH tick 1920, never the hidden LH rest.
Evidence lives in Same Page's
`artifacts/transcription/2026-10-21/ifmusic-current-quality-adjudication/fermata-scope-fix/`.
This is a finite measure-80 check, not full-score certification, installed-package
acceptance, member readback, subjective listening, or production deployment.
The original PDF/XML and ambiguous diagonal strokes were not changed.

The build tooling assumes `.git/HEAD` is a directory path and fails in linked
worktrees. For this local proof only, the tooling's HEAD lookup was temporarily
resolved through the worktree `.git` pointer and then restored. No build-tooling
change is included in this patch.

## Inverted source fermatas

The combined native14 source surfaced an additional defect in the real MusicXML
42a two-voice fixture: its second voice explicitly has `type="inverted"`, but
both fermatas were painted upright in the top band. This is a real orientation
regression, not a neutral snapshot/default-field difference.

`Fermata.isInverted` now retains this source instruction through public JSON and
deep cloning. Its default is false, including old JSON. Separate effect IDs route
upright notation to the existing top band and inverted notation to the existing
bottom band. The above-band ID is unchanged. Below glyphs use SMuFL E4C1/E4C5/E4C7
for normal/short/long shapes, with Bravura's actual below bounding boxes and a
baseline aligned to the below band's top. Source `type` controls orientation and
staff side; arbitrary source engraving coordinates are not implemented here.

The actual 42a fixture first failed with two E4C0 symbols. Regression tests now
assert E4C0 plus the respective below symbol in Page and Horizontal layouts after
JSON round-trip, with actual paint baselines outside the staff's SVG lines. Clone
isolation, legacy defaults and unchanged MIDI remain covered. White-background
captures of all six layout/shape combinations were inspected for orientation,
coexistence with above/below lyrics and dynamics, and clipping. These are local
source-render checks, not installed-package or production acceptance. The earlier
source-owned two-fermata and visible-rest regression tests remain active.
