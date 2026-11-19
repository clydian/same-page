# Requested removal blocked by an existing recovery-path gap

Inspected head6b20bb2da1fcd0d26d7daae55b1d3e470450e12e, no product changes.
The previous move to Advanced did not satisfy the request to remove the line
from normal online practice even when Advanced is open. That work is incomplete.

Confirmed coverage, not assumptions:
- offline-score.ts prepares PDF and attachment directory metadata.
- prepareAttachmentDirectory explicitly requests metadata only, never XML bytes.
- ensureOfflineAppShell (annotations/offline-snapshot.ts:54) checks only that an
  active ServiceWorker exists. It does not issue SAME_PAGE_PLAYBACK_READY and
  does not audit/repair the current player resource bundle.
- prepareOfflineMusicXml saves verified original XML and issues that separate
  player resource readiness request before checking private offline eligibility.
- When bounded local I/O times out, resolveMusicXmlSource returns
  canSaveAutomatically=false and a lazy explicit save function. The cleanup
  fence intentionally prevents late background work from recreating deleted
  XML. retryOffline is the only product action currently able to acquire a new
  explicit write intent and run this save without reopening/reloading audio.
- Existing offline open error/Retry only reopens the source; it does not call
  retryOffline or represent the required new private offline write intent.

Re-ran17 existing tests across musicxml-cleanup-intent.test.tsx,
musicxml-opening.test.ts and offline-player-assets.test.ts: all passed. In
particular, automatic late restoration is prevented while explicit retry can
capture a fresh cleanup fence and restore the original. No tests were deleted,
no eligibility rule was weakened, and no new tests/design/entry was introduced.

Consequently removing the only visible retry would lose a real recovery path;
claiming the library action covers it would be incorrect. Satisfying both goals
needs an explicit decision about which existing user action should authorize
XML offline preparation and how it retains progress, retry and cleanup fences.
No silent coupling of unrelated actions was implemented as a "small" deletion.

Fresh screenshots at the unchanged head use the actual built product, local
Worker/D1/R2, synthetic Chinese two-part score, .6 scale, DPR1,390x844. They are
counterevidence of the remaining gap, NOT a claim of completed new UI. All were
opened and personally checked: default is clean, Advanced still contains the
sole preparation failure/retry line. Original WebKit fix remains intact.

CI remains for the unchanged head:
https://github.com/clydian/same-page/actions/runs/44553161464
https://github.com/clydian/same-page/actions/runs/44553161567
