# Actual product practice settings

Before: PR #680 original head 980b7a6. After: 13c6976 (layout and lyric size).
Real built SamePage React UI, local Worker/D1/R2 seeded via the existing
startStorageFixture preview helper, actual source upload and player opening.
Synthetic Chinese two-part score, 24 measures with Chinese lyrics in both parts.
Chromium, zh-CN, deviceScaleFactor 1, notationScale .6, desktop 1024x900 and phone
390x844. No production writes. Both before and after images were opened and
personally inspected. UI controls used pointer and keyboard operations.

Default: lyric size is visible, mixer collapsed. Mixer expanded: focus enabled,
female alto selected, other voices 5%, existing per-voice mute/solo retained.
Compact: mixer collapsed but focused voice remains discoverable in its row;
loop and specific solfege range enabled. The loop content is approximately
192px high on desktop (previously about 250px), keeping 44px endpoints/stepper.
Large after reopening: 18, not the rejected 20-unit candidate which crowded
five-character lyrics. Spacing stays at the previous PR's stretchForce 1.5.
No additional note size or overall spacing changes.

Native text sizes measured from actual SVG after selection: 12 -> 7.2px,
16 -> 9.6px, 18 -> 10.8px at .6. The one-time verification checks focused part,
other volume, loop and solfege selection stay unchanged through all sizes.
Playback stays active when changing size after seeking to measure index 5;
position does not reset. Reload and explicit reopen restores 18 and native
10.8px. See validation.json and the one-time scripts (not new CI screenshot tests).

The player remains synthetic, so this proves engineering behavior and visual
layout, not readability of every user score or physical HarmonyOS/Safari/iOS,
aural soundfont quality, or production network behavior. Font layout can still
crowd unusually long words; the native horizontal lyric algorithm is unchanged.

The baseline lacks a dedicated persisted practice-options store. The change
reuses the existing owner-isolated appearance store/provider for this notation
preference, merging the latest saved fields, retaining earlier themes, handling
storage unavailability, and preserving existing user/experience/logout rules.

Validation: lint, typecheck, production build (including precache audit), 395
player tests, 15 targeted appearance/loop/player client tests, 58 existing
opening/source/lifetime tests, diff whitespace check, and actual product actions.
No full product unit/client/Worker/browser suite, real-device/PWA validation,
new timbre override or production error reproduction. Additional investigations
are recorded separately in investigations.md.

Reproduce with npm ci and npm run build, place product-capture.mjs temporarily
at repository root, run it and then playback-reopen.mjs (adjust CDP port/path
if needed). Scripts use an independent local seeded fixture, not mock product UI.
They remain running for manual inspection; stop the fixture process afterward.
