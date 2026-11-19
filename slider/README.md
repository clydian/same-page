# Fine lyric slider and advanced settings — actual product evidence

Product head: d43fad1. Comparison: previous #680 head 13c6976, with old UI
screenshots retained in ../settings on this evidence branch.

Real built SamePage UI with local Worker/D1/R2 via the existing storage fixture;
normal upload and opening of a synthetic Chinese two-part, 24-measure MusicXML
with Chinese lyrics in both parts. Chromium, zh-CN, .6 notation scale, DPR1,
desktop 1024x900 and phone 390x844. Default and advanced screenshots were opened
and personally inspected, as were the previous desktop/phone images.

Changes visible in screenshots:
- Default: mixer, loop, solfege, genuine offline state/retry, collapsed advanced.
- Advanced: existing metronome and count-in switches (same default/behavior),
  lyric slider with explicit value. No extra categories or static playback/PDF
  explanations. The genuine offline-not-ready status in the seeded fixture is
  deliberately retained rather than hidden for a cleaner capture.
- Range12..18 step0.5, default16, old12/16/18 saved choices stay valid. A pointer
  drag previews only the value; release applies native layout and saves. Keyboard
  steps apply through the accessible slider's native input behavior. Component
  uses the same React Aria library as the existing loop control, with a labeled
  native range input and a 44px thumb target, existing colors and value styling.

Deterministic actual UI checks (validation.json):
- Mouse drag through 12 move events to16.5: no preference writes during drag,
  original native font9.6px unchanged; release writes once and changes font9.9px.
- ArrowRight changes16.5->17, native10.2px.
- CDP touch drag reaches16.5 without early storage write, commits9.9px on release.
  This is emulated touch, not physical-device certification.
- While playing after seeking to measure index5, intermediate changes keep audio
  transport playing, progress at5 or later, loop enabled, focused alto and other
  voice volume5% unchanged.
- Reload and explicit reopen restores16.5 and9.9px while advanced starts collapsed.
- Both moved rhythm switches start off and toggle from their new entry. Existing
  precise-speed/count-in Chromium browser regression also passed.

Aesthetic review: the existing restrained green colors, mixer nesting, and compact
loop controls are already coherent. The previous default view was too long for
its main tasks because of constant lyric-size controls and static prose. Hiding
less-used controls and removing prose is the useful small refinement. The new
slider's numeric output aligns with the existing volume outputs; its larger hit
area does not require a large visible thumb. No unrelated restyling was needed.

Checks: production build incl precache audit, typecheck, lint,395 player tests,
14 targeted appearance/setting/loop client tests, Chromium rhythm browser test,
git diff --check. Not run: full Node/client/Worker/browser suites, Opus browser
regression (only its new disclosure-entry locating was updated), WebKit or
physical HarmonyOS/Safari/iOS/PWA validation. No screenshot assertions added.
No further timbre or attachment-error behavior changes; no merge or deployment.

One-time reproduction: npm ci; npm run build; temporarily place product-capture.mjs
at the product repository root and run it, then interaction-reopen.mjs (adapt
absolute checkout paths/CDP port if necessary). The scripts retain the fixture
for inspection. They are evidence utilities, not product code or CI tests.
