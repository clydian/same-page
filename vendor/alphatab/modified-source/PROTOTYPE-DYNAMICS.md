# Explicit source dynamic notation prototype

This local prototype adds `Beat.isDynamicsExplicit` (default false). A caller that has independently recovered an exact source declaration sets the beat's `dynamics` and this flag. The native renderer then draws that declaration on a real rest, in an otherwise rest-only voice, or when its value repeats. Global `hideDynamics` still takes precedence. Existing empty cross-staff beat anchors may carry an exact source direction; callers do not add or retime beats to obtain an anchor. An explicit rest becomes the previous visible declaration so its inherited value does not reappear on the next sounding note.

The flag changes engraving only. It does not change `Note.dynamics`, note duration, beat position, or MIDI generation. Existing unflagged models retain their old behavior. Generated JSON serialization and cloning preserve the flag; this does not alone prove a complete Worker/UI integration.

The public MusicXML importer has not been changed to identify exact source declaration positions. Chorus must project its complete, source-timed metadata after playback dynamics are computed, with whole-track fallback when an anchor cannot be represented. Do not mark every inherited beat explicit or invent/split beats to obtain a convenient anchor.

Validation: six owned tests, fifteen typed-lyric tests and nine legacy lyric tests pass, plus TypeScript. The rest-only actual native SVG was independently checked. This branch also includes the independently verified melismatic syllable fix (original f89fe54, cherry-picked as 4691348). This prototype is not published, packaged for production, or deployed.

Build note: the upstream license-banner helper assumes `.git/HEAD` is a directory path and fails in a Git worktree. Build an independent clone of the committed prototype for the bundle proof; do not remove license banners or fabricate a Git directory. Keep failures as diagnostic evidence.

## Independent bar-time declarations

`Bar.sourceDynamics` is an optional display-only list of `{ displayStart, value }` declarations on that staff. Times use display ticks (960 per quarter) relative to the bar. Null retains legacy inference; a complete array, including an empty array, opts that bar into exact source notation. A native effect band is reserved using the existing initial beat, but each sign uses its own time through the shared nonlinear spring layout. Exact times shared with another staff align to its on-time anchor. Positions inside sustained notes interpolate between the surrounding actual springs; the final interval ends at the bar's actual post-beat boundary. The mechanism never creates/splits a beat, moves a declaration to another staff, or changes note velocities. Worker serialization preserves all declarations. Bars containing declarations report a change so rest condensation cannot silently swallow their signs.

The motivating case is Finzi Piano14: `mp` on staff1 at q3.5 has no staff1 beat after a cross-staff move. A minimal two-staff held-RH/LH-attack reproduction initially produced zero MP signs and lost the list on JSON roundtrip. Owned tests now cover that case, shared layout at two widths, sustained-note interpolation, repeated declarations, hiding, and serialization. This is a local source prototype; real-score wrapper projection, full MIDI protection, and browser review are required before integration.

Source placement follow-up: `SourceDynamic.placement` optionally selects the
public `SourceDynamicPlacement.Above` or `.Below` native lane. Omission retains
the existing below-staff behavior and old structural model objects remain valid.
The standard-notation renderer registers separate upper/lower effect bands;
each filters the same independent-time declarations and uses the existing shared
spring geometry. Visibility controls hide both bands. Worker JSON retains the
optional enum without adding playback events or beats. This supports authored
above/below placement, not exact MusicXML default-y/relative-y or arbitrary voice
lanes; tablature-only placement and collisions with all other effect types are
not claimed accepted by this narrow prototype.
