# MusicXML preparation Worker and cache options

> 本文保留实施前的研究基准与决策依据；其中“当前”指该研究版本，不代表 #551 合入后的行为。产品实现和可执行回归见 [实施验证记录](../verification/2026-10-22-musicxml-startup.md)。原始诊断脚本留在研究工作区；本仓库仅收录不含谱文的摘要。

Date: 2026-10-22. Read-only architecture investigation; no product-source changes. All executable experiments use the exact installed `@coderline/alphatab@1.8.4-samepage.13` / player `0.1.19-samepage.12` pair under `artifacts/transcription/2026-10-21/native-notation-performance-release/installed-pair13-host`, rather than assuming the root development `node_modules` matches production.

## Recommendation

Implement the lower-risk preparation boundary first: include ties/repeats normalization and printed-measure labels in the preparation Worker output, retain a bounded immutable preparation per authorized source revision, and eliminate duplicate MIDI generation within one newly created practice session. Treat a whole-Score Worker/cache as a separately measured option, with explicit score-serialization fidelity tests before adoption.

Moving CPU work into a Worker can improve responsiveness while leaving total startup time unchanged or worse. Whole-Score import adds serialization, structured cloning, main-thread class reconstruction, a second `Score.finish()` and a large transient graph. It is not automatically a stronger version of the simple preparation change.

Domain constraints from `CONTEXT.md:141-142` and ADR-0004 still apply: each explicit attachment open creates an initial-state practice session; source authorization and ownership remain host responsibilities; preparation is an optional bounded memory optimization; no playback position, speed or mix is persisted. No IndexedDB format migration is needed for the initial changes.

## Current preparation boundary

- `packages/player/src/prepare.worker.ts:1-10`: a small source-only Worker performs format/source validation, MXL expansion and direction timing preparation, returning exactly `{prepared}`.
- `packages/player/src/musicxml-direction-timing.ts:538-583`: XML is parsed once here already, and creator/tempo/time-visibility/dynamic/word/wedge metadata is collected. Printed first-part measure numbers can be collected from this tree without another full-document DOM parse.
- `packages/player/src/session.ts:178-182`: every session uses `DOMParser` to extract measure labels and then calls `loadPreparedMusicXml` on the main thread, including preparation-cache hits.
- `packages/player/src/engine.ts:22-69`: before native import, ties normalization and repeats normalization each parse XML again. After native import the engine applies duplicate-title, creator-role, tempo, time visibility, note-dynamics and source notation corrections.
- `packages/player/src/session.ts:183-197`: session-specific model configuration clears line breaks, hides ordinal measure numbers when needed, assigns independent MIDI channels, applies the choir timbre profile and renders.
- `src/client/playback/playback-preparation.ts:4-32`: cache is 4 items / 32 MiB / a fixed 5-minute TTL from insertion, scoped by local owner, effective session, drive, score, attachment and revision. It accounts for raw and prepared byte arrays but not all nested metadata. A cache read updates Map recency but does not renew TTL. Active practice can outlive the cached preparation.

There is currently no reason to move printed-measure labels, ties normalization or repeats normalization back onto the main thread on a hot open. They depend on source content and preparation version, not the DOM, viewport, AudioContext or current mix.

## Option A: more complete immutable prepared input

Produce the native-import-ready bytes and measure-label metadata in the existing source Worker. The main thread still constructs a fresh native Score, applies model corrections, creates the playback session and attaches the view.

Suggested boundary:

1. Validate/decompress the original XML/MXL.
2. Collect source declarations and printed measure labels while the existing ordered XML tree is available.
3. Perform existing direction timing, ties and repeat-ending transformations in the established order.
4. Return an explicitly versioned prepared record with import-ready bytes, source metadata and labels.
5. Cache this record under the source revision and preparation version; use it read-only.
6. On each explicit open, import a new Score, apply model corrections and the session defaults, then render.

Keep existing normalization semantics first. Unifying all three transformations into one tree traversal is a separate potential cold-open optimization: it changes ordering and error/fallback behavior and requires existing ties, repeats and source direction regressions to remain identical.

Compatibility should be additive. For example, accept older prepared records with no normalized-import marker or labels and take the existing fallback path. Avoid silently reinterpreting `prepared.bytes` without a version marker, since the exported player format API and admin review reuse it. If a separate `importBytes` field is used, budget that second byte array explicitly. A new preparation schema is a memory record and need not become an IndexedDB migration.

Benefits:

- Removes repeated XML normalization and measure-label parse from the main thread and from hot opens.
- Keeps the current small Worker protocol and avoids loading native rendering/synthesis runtime into it.
- Does not add a Score serialization/reconstruction pass.
- Preserves the existing native-import-then-correct ordering.

Limit: native import, model corrections, MIDI generation, soundfont parsing and notation layout still cost time; large scores may retain a long main-thread task after preparation returns. The previous Node CPU breakdown is evidence of remaining work, not a phone latency forecast.

## Option B: import the whole Score in a Worker

A safe version of this option is a compiler boundary, not `postMessage(score)`. Score contains methods, circular references and mutable links. Use the vendor's documented conversion machinery or a carefully specified custom DTO, not structured-cloning a live class instance.

Even `JsonConverter.scoreToJsObject` is not a transparent frozen snapshot. It returns nested Maps and arrays; `JsonConverter.jsObjectToScore` builds classes and calls `score.finish(settings)`. Maps can be structured-cloned without a stringify/parse round trip, but they still require a large graph to be cloned. `Object.freeze(map)` does not prevent `map.set`; an internal read-only ownership contract or immutable encoded representation is needed for a retained canonical template.

### Native library auto-initializes unrelated Worker protocols

The installed native13 `dist/alphaTab.mjs:54` checks `Environment.isRunningInWorker` and calls `Environment.initializeWorker()`. Native13 `dist/alphaTab.core.mjs:67165-67169` starts both renderer and synthesizer Worker handlers. A preparation Worker that imports the full public native entry therefore acquires unrelated runtime behavior and may emit unrelated initialization messages.

The existing exact-built-asset regression at `browser-tests/musicxml-playback.test.mjs:11-38` requires the first message to have exactly the `prepared` key, and explicitly rejects renderer/synth initialization messages arriving first. Merely filtering out those messages would hide the side effect, not establish the right import boundary.

`alphaTab.core.mjs` exports the model/importer classes without the main entry's explicit Worker initialization, but the package `exports` currently exposes only the standard, webpack and vite entries plus fonts/soundfonts. A production implementation should add a deliberate pure core/compiler entry in the vendored artifact, with reproducible package metadata and versioned hashes; a path that circumvents package exports or a global Environment hack is a less stable interface. All transitive engine helpers must use the same pure entry in that Worker. One hidden full native import is enough to reintroduce initialization.

### Reproduced: rebuilding final corrected Score loses note dynamics

The isolated diagnostic `artifacts/diagnostics/musicxml-startup-2026-10-22/score-roundtrip.mjs` does:

`loadPreparedMusicXml → scoreToJsObject → structuredClone → jsObjectToScore → generate native MIDI`

It uses the exact native13/player12 installed artifacts. Results are saved in `score-roundtrip.json`.

| Input | Notes | Notes changed by round trip | Different MIDI events | JSON representation bytes |
|---|---:|---:|---:|---:|
| Minimal hairpin + unmarked accompaniment | 5 | 3 | 6 | 10,621 |
| The Sun Never Says | 1,422 | 1,358 | 2,216 | 2,544,552 |
| Jesu, meine Freude | 7,694 | 7,588 | 15,542 | 13,515,069 |

These are functional comparisons and representation sizes, not Worker transfer or phone timing measurements. JSON size is an estimate of representation scale, not an exact JS heap estimate.

Root cause: `vendor/alphatab/modified-source/packages/alphatab/src/model/Beat.ts:1080-1083` unconditionally sets `note.dynamics = beat.dynamics` during finish. The player deliberately separates printed beat dynamics from playback note dynamics; many beats use -1 to avoid invented dynamic glyphs. Hydration resets the hairpin curve and normal unmarked-note velocity; generated velocities in the diagnostic can fall to 1.

Reapplying `applyAlphaTabPlaybackDynamics`, then `restoreMusicXmlWedgeGlyphs`, after hydration restored exact generated MIDI equality for all three samples. This suggests the cleaner first B experiment is:

`Worker normalize + native import → native serialized import model → main hydrate → all post-import model corrections → session configuration`

It is less convincing to move all corrections into the Worker and then have to repeat some of them on the main thread. Correctness needs an explicit separation between native import and final player corrections.

After the repair, the full serialized model matched exactly for the minimal fixture and Jesu. Sun retained one `slurdestinationnoteid` difference (247 → 246, track 1 / staff 0 / bar 28 / voice 0 / beat 0 / note 0). MIDI equality alone therefore does not certify notation/relationship equivalence. Current rendering already uses the same JsonConverter machinery for its own renderer Worker; compare the final renderer model and output, including the extra round trip, before attributing a new visual regression.

### Added native fields mostly have deliberate serializers, but that is not enough

The vendored generated serializers explicitly cover these additions:

- `generated/model/BarSerializer.ts:57-68`: source dynamics, wedges, words, graphic brackets; notation changes and bar-line variants are also represented.
- `generated/model/BeatSerializer.ts:63-100`: typed source lyric relationships, source tuplet bracket/number, source chord staccato, explicit dynamics and tremolo structures.
- `generated/model/NoteSerializer.ts:55-83`: cue/small notes, source playback passes, slur/tenuto placement, mordent step and per-note dynamics.
- Source declaration serializers retain positions, placement, progress, words and fonts. `StaffNotationChangeSerializer` retains source clef/key visibility and cancellation.

Existing focused round-trip tests cover many of these additions (`native-source-display-fidelity`, `native-source-notation-playback`, `native-direction-brackets`, `native-slur-placement`, `native-tenuto-placement`, `musicxml-crossvoice-ties`, source words and source dynamic tests). They do not prove final corrected Score round-trip MIDI equality; the reproduced dynamics failure demonstrates that a field being serialized does not mean `finish()` preserves its meaning.

### Why whole-Score cache may move the bottleneck

For the two real files, serialized JSON is approximately 5× the XML size. A cache budget that counts only 0.5/2.5 MiB of XML would undercount a model template substantially. Worker import may momentarily hold raw bytes, normalized string/tree, native Score, serialized Map graph, cloned main-thread graph and hydrated main-thread Score simultaneously. The renderer then creates its own serialized graph and Score in another Worker.

On constrained iOS/Android devices this may increase GC pressure or memory termination risk. Measure input decoding, Worker module initialization, serialization, postMessage call, time until receipt, hydration, model corrections, maximum main-thread task, heap peak where observable, ready-to-play, first SVG and visible paint separately. Do not estimate B's benefit by subtracting native import CPU time alone.

## MIDI: deduplicate within a session before caching across sessions

Native13 `alphaTab.core.mjs` has multiple current startup callers:

- `_internalRenderTracks:47015-47016` invokes `_onScoreLoaded`, then directly `loadMidiForScore`.
- `_onScoreLoaded:49195-49199` may call `loadMidiForScore` itself.
- `_setupPlayerWrapper:46753-46755` calls `loadMidiForScore` when the synth becomes ready.

The previous browser experiment observed 2–3 generations. The first optimization should give a score generation one prepared playback payload and ensure the current synth has that generation loaded. Separate `ensureGenerated(generation)` from `ensureLoaded(synth, generation)`; keep explicit public regeneration or genuinely playback-affecting settings/model updates as invalidation events. A global no-op guard keyed only by Score identity would break intentional `loadMidiForScore()` calls after callers mutate a Score.

The payload is more than a MIDI file: `loadMidiForScore:47892-47917` sets the tick lookup, its playback range, the `midiLoad` seam, tick shift, backing track, sync points and transposition pitches. `piano-shared-attacks.ts:80-100` may regenerate and repair simultaneous acoustic-piano attacks at `midiLoad`. Generation/loading changes must retain that correction exactly once for each newly generated payload and preserve event/ready behavior.

A cross-session MIDI cache cannot directly reuse the old `tickLookup`. Native13 `MasterBarTickLookup:43163` and `BeatTickLookupItem:43055` retain actual MasterBar/Beat object references from their generating Score; `MidiFileGenerator:44335-44355` binds them. A new session has a new Score and needs a re-bound or rebuilt timing map. Caching only MIDI bytes leaves this problem unresolved. This is a reason to defer cross-session MIDI caching until same-session duplication is fixed and measured.

## Cache identity and mutation rules

For initial work, retain the existing owner / effective session / drive / score / attachment / revision isolation and denial/logout/cleanup fences. The source key is a permission-scoped identifier, not access authority. Never share a protected Score template solely by its XML hash across owners.

Additional prepared/model key dimensions:

- Preparation schema/normalization version, player package and exact native artifact identity.
- Native import/finish settings fingerprint: at least importer options (`mergePartGroupsInMusicXml=false`) and any notation/model-affecting settings actually used by the compiler.
- Original immutable revision identity; checksum if supplied/verified locally. Hashing must not introduce a fresh full-byte pass on every hot hit solely to derive a key already certified by revision.
- For a cached MIDI payload, include the channel assignment policy, timbre/profile version, playback-affecting settings/score generation and piano-correction version. Display width/scale should remain outside a source/MIDI key when they only trigger reflow.

Do not retain the running Score as the reusable entry. `session.ts:184-189` mutates line breaks, numbering, channels, timbre programs, automations, volume and balance; native rendering applies derived pitch offsets and Score links/derived fields are mutable. Current `changeTrackVolume/Mute/Solo` methods change synth channel state rather than Score fields, so that specific mix operation is not evidence of Score pollution. A shared live API/synth additionally carries position, loop, speed and channel state and conflicts with the initial-state session contract.

Retain immutable source preparation or an explicitly canonical serialized template, and build one independent mutable runtime model per explicit open. For retention, evaluate idle expiry from last use or from session release, with an active-source pin and strict count/byte budget; an arbitrary large TTL or unbounded keep-alive synth should not be the first fix. Cache misses remain valid fallback paths. No cached prepared/model record is allowed to restore denied access.

## Focused acceptance cases

1. Exact-built preparation Worker first-message protocol on Chromium and WebKit; no renderer/synth side effects, and disposal terminates work and prevents late cache writes.
2. A and baseline produce identical source labels, native import model, generated MIDI and source bytes for ties, repeats/alternate endings, pickups, hidden meter, offbeat directions and long real scores.
3. If B remains beneficial, compare complete final model and generated MIDI through zero/one/two serialization rounds; verify source words/fonts, wedge spans, dynamic velocities, slur/tie identity, lyrics, tuplets, cue/playback passes, tempo and custom measure labels. Include the newly reproduced unmarked/hairpin velocity failure and Sun slur case.
4. Reopening always resets position/speed/loop/mix/solo/solfege defaults; view switching within the same session preserves them; two concurrent instances never mutate a shared template.
5. Per-session MIDI generation count is one for an unchanged score even when synth readiness and render order vary; explicit regeneration and true settings changes still work; piano correction, tick cache, seeking, loops, tempo changes, cursor and initial ready events remain correct.
6. Source revision change, attachment denial, owner/effective-session change, logout, drive denial and local cleanup invalidate or fence the corresponding preparation, including work that completes late.
7. Test short/medium/long scores with cold resources, warm resources + no preparation, same-score reopening after a realistic rehearsal duration, different-score opening, memory eviction, PWA resume and offline; validate actual iOS installed PWA and Android installed PWA separately before publishing phone-specific latency claims.

## Open measurements

Browser A/B numbers for partial preparation versus whole Score/hydration belong in the parent investigation. This memo establishes semantic and architectural risks independently of those measurements. No physical phone/PWA execution or memory-pressure result is claimed here.

## Concrete single-byte-array prepared interface for Option A

Keep original attachment bytes in the host's existing raw-byte record. Within the reusable prepared value, keep only the final native-import input and metadata; the intermediate direction-normalized XML becomes collectible after Worker preparation.

A suggested additive interface (illustrative, not implemented):

```ts
const CURRENT_IMPORT_INPUT = 'direction-timing-ties-repeat-native13-v1';
interface PreparedMusicXml {
  bytes: Uint8Array;
  // Absent means the existing direction-only prepared format.
  importInputVersion?: string;
  measureLabels?: string[];
  // Existing creator / tempo / visibility / dynamic / wedge / word metadata.
}
```

Use a separately named compiler entry such as `prepareMusicXmlForPlaybackBytes`, leaving `prepareMusicXmlForAlphaTabBytes` as the existing direction-only operation if its exported API semantics should stay stable. The new entry performs:

1. `prepareMusicXmlSource(originalBytes)` validates and expands XML/MXL.
2. The existing direction preparation parses the ordered tree, collects original source metadata plus first-part printed measure labels, and runs the current direction-timing transformation. Labels are read before transformation and use the exact existing trim / empty-number / ordinal fallback rules.
3. `normalizeMusicXmlTransposedTies(directionPrepared.bytes)`.
4. `normalizeMusicXmlRepeatEndings(tiesNormalizedBytes)`.
5. Return `{ ...directionPrepared, bytes: finalImportBytes, measureLabels, importInputVersion: CURRENT_IMPORT_INPUT }`. Do not return either intermediate byte array. Do not touch the caller's original attachment bytes.

`loadPreparedMusicXml` then chooses one native import input:

- Current recognized `importInputVersion`: directly import `prepared.bytes`, skipping normalization.
- Absent marker: preserve the exact existing ties→repeats normalization fallback, allowing older manually supplied/admin/test prepared payloads to keep working.
- An unknown explicit marker: treat as an incompatible preparation/cache miss at the host boundary and recreate from original bytes; do not blindly reinterpret already-normalized bytes as the old format. Package-local callers can surface an explicit incompatible-format error if no original is available.

Continue all existing post-import corrections in their current order: title / creator roles, tempo, hidden meter, playback dynamics, wedge glyph/source declarations and words. Then keep the current per-session setup. This moves where source normalization runs; it does not revise normalization, pitches, meter, dynamics, transpose, original storage, authority checks or user session defaults.

For compatibility and cache correctness, include `CURRENT_IMPORT_INPUT`, player artifact identity and native artifact identity in a preparation cache algorithm key or clear entries when any changes. The memory cache is scoped to one loaded build today, so no persistent migration or old-client invalidation is required. If a future persistent derived cache is introduced, those identities become stored validation fields and unrecognized entries must remain disposable cache misses.

Measure-label consumers use `prepared.measureLabels` when present and retain the current DOMParser fallback for unversioned old payloads. New compilation always supplies labels (including an empty array when there is no first part), so normal new opens never need this DOM parse. Define the optional field as absent versus empty explicitly, avoiding `labels.length` as a presence check.

Even with one prepared XML byte array, total cache accounting still includes the original bytes and nested metadata in addition to that final array. Keep source metadata from the original ordered source tree rather than reconstructing it from the modified native input; ties/repeats normalization must not accidentally change what counts as a source declaration.
