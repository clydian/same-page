# Online practice vs offline preparation, and isolated footer navigation

Final product head: 6b20bb2da1fcd0d26d7daae55b1d3e470450e12e.
UI-only change: move the existing offline status/retry line inside the existing
Advanced settings disclosure. The default online view no longer shows the line
or its root-level separator. No changes to background preparation, offline
eligibility, download, playback, fonts, lyric algorithm or storage ownership.
No new permanent entry; explicit recovery remains available in Advanced.

Coverage audit:
- Library OfflinePreparation verifies PDF and the app shell; its optional
  prepareAttachmentDirectory explicitly saves only attachment metadata, without
  downloading XML originals. Shell installation covers public player resources.
- Practice prepareOfflineMusicXml saves verified original bytes, asks the worker
  for SAME_PAGE_PLAYBACK_READY/current build readiness (including public player
  resources), then rechecks private offline source eligibility/fences.
These readiness paths overlap but are not equivalent; library PDF readiness
cannot replace this existing practice retry path.

Screenshots use the real production-built SamePage UI and a locally seeded
Worker/D1/R2 with a synthetic Chinese two-part 24-measure score. Chromium zh-CN,
notation scale .6, DPR1, narrow390x844 and desktop1024x900. All images were opened
and personally checked. No mock UI, image processing, production writes or new
screenshot assertions. Old comparison images remain in ../slider.

Actual UI verification:
- Online: play enabled, default settings omit offline status and retry; advanced
  exposes existing failed preparation retry.
- Explicit retry: defer the real serviceWorker.getRegistration audit promise in
  the browser, press the existing button and observe Preparing; release it with
  no active worker and observe failed/retry again. This controlled dependency
  is not a claim of a fully completed offline bundle.
- Real browser context setOffline(true), explicit reopen without an eligible
  bundle: the original "not prepared for offline" error and Retry are visible.
  setOffline(false), Retry: playback becomes enabled, default settings stay clean.
- 35 existing opening/cleanup/offline/player-asset tests pass, including private
  cleanup fences and offline readiness/failure semantics.

Navigation change: remove the extra privacy->drives->brand-click prelude from
public footer keyboard test; start directly at / as a guest. Member root entry
intentionally resumes a drive (the first direct-/ member run demonstrated this
existing behavior), so use the correct public-page fixture. Signed-in privacy
return tests for pending-content/content-handoff remain unchanged. All footer
keyboard, document marker and direct privacy access assertions remain.

WebKit verification:
- pending-content return PASS
- content-handoff return PASS
- public footer keyboard/direct privacy PASS after correcting guest precondition
The three selected checks were not rerun until green, and no retries, sleeps or
extended timeouts were added. Browser2370 was downloaded; missing runtime libs
were extracted to /tmp and linked into that browser's local bundle. Host
ldconfig preflight was skipped because it cannot see these local libraries;
actual WebKit execution and assertions were not skipped.

Checks: lint,typecheck,production build incl precache audit,diff whitespace;
35 targeted client tests and the three WebKit checks above. Full suites and
physical device/PWA offline certification not run.
Original CI failure: https://github.com/clydian/same-page/actions/runs/44543029208
New CI: https://github.com/clydian/same-page/actions/runs/44553161464
Extended browser: https://github.com/clydian/same-page/actions/runs/44553161567
New workflows were in progress when recorded; no full-CI-green claim.
