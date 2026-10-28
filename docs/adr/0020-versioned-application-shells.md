# Version application shells independently of deployed and waiting workers

A running legacy worker, a waiting release and another installing release can coexist.
Workbox's shared precache activation removes another installer's already-written
entries. An index cache miss then follows the host's index.html redirect, which
cannot be returned as a navigation response. This can produce a native ERR_FAILED.

## Invariants

- Each immutable manifest has its own scope-qualified `same-page-shell-v2:` cache. Existing `v1` shells keep their original addresses.
  The name deliberately contains neither the legacy `-precache-` selector nor a
  raw registration scope. No new worker runs Workbox's broad cache cleanup.
- Installation verifies every response against the build's SHA-256 manifest;
  readiness is sealed only after the entire manifest is checked again. Activation
  rechecks and repairs before use. Failed admission/download never evicts a usable
  release. The canonical shell URL is `/`, with index.html's revision and integrity.
- Installation and activation audit a complete release. Navigation checks the
  sealed manifest's required keys and hashes the root document before responding;
  a full wake-up audit follows the response, and each served asset is hashed.
  Missing required entries trigger exact repair or a complete retained release.
  A new deployment's HTML is never cached under an older manifest. Failure renders
  a small retry page rather than returning a redirect or throwing a fetch error.
- Hash assets may be served from retained releases and legacy precaches, keeping
  old HTML/in-flight navigations readable during controller changes. APIs and OAuth
  are never shell fallbacks. Multi-window update vetoes remain; safe visible idle library/home/about windows may initiate an automatic handover. Editors, readers, playback, focused input, dialogs and active operations veto it.
- Only v2 owned caches are collected. Keep active/waiting/installing, live page
  versions and one verified historical rollback (already-referenced history may
  serve as that rollback). There is no per-activation 24-hour grace or aggregate
  shell-byte admission cap. Unknown/frozen windows defer historical retirement
  and veto unsafe handover, but do not block staging a new release. They do not
  retain superseded v2 candidates that are still positively sealed as candidates and have no
  registration role or current installation lease.
- Navigation fallback can use legacy complete shells or durably permitted-for-display
  v2 shells, never an arbitrary complete v2 waiting candidate. The v2 namespace
  prevents older v1 workers from displaying or pruning these new candidates.
- v1 complete shells form a fixed compatibility set: old pages cannot be patched
  with new BFCache guards. They are not copied or joined by subsequent v2 releases.
  This deliberately accepts the existing bounded legacy footprint rather than
  adding leases or an arbitrary migration timer. Existing Workbox, PDF/annotation
  databases and runtime animation caches remain outside collection.
- Web Locks serialize installation bookkeeping and collection. Without locks,
  collection is deferred. Use a fixed snapshot and recheck roles/pages before each
  deletion. One individual manifest remains bounded to 7 MiB in build and install;
  actual browser quota refusal remains a failure, preserving the current and any
  already waiting release. Only if owner collection actually deletes unused public
  caches may a quota-failed candidate retry once. No global data reset is allowed.


The worker is authored with injectManifest, using CacheStorage directly rather
than wrapping Workbox's global cache names/activation hooks. Only shell metadata
and manifests live in its separate registry cache; business IndexedDB is untouched.
Legacy updates need not understand the new protocol or cache naming. Versioned
cache isolation makes an install guard unnecessary; a waiting legacy worker can
activate without deleting the new installer's cache.

Update feedback from #456 stays in place. A failed newer installer must preserve
an already-waiting release's update action. This decision does not authorize
publishing or changing production settings.

Identical public bytes can be copied from retained or legacy caches only after
matching the new manifest's SHA-256 and MIME, avoiding a full network download
for every small release. This copies responses into the new owner's cache;
activation never shares or prunes another owner's bookkeeping. Explicit static
file navigations bypass the HTML fallback, and encoded API paths stay excluded.

Full checks use four bounded tasks; candidate downloads have a five-minute total
deadline, allowing high RTT without serializing 120 network round trips. Existing
healthy shell reads do not depend on quota for rewriting registry metadata. A
response captured before cache eviction remains safe; a missing final response
always enters fallback rather than escaping respondWith as undefined. Asset
metadata is read once per worker and invalidated by collection or shell fallback; a stale snapshot
uses cache-name lookup without recreating a retired namespace.

## 2026-10-21 revision and restoration

Issue #523 confirmed four retained shells totaling 26,435,530 bytes blocked the
next installer under the former 28 MiB aggregate limit despite ample estimated
browser quota. Increasing that cap only postpones the same conflict. The v2
rules above replace the former four-shell cap and blanket 24-hour grace together.

Stage and validate before activation. Safe foreground idle pages may automatically
request handover, using the same path as a manual request. Manual requests bypass
only idle time, not active work or cross-window vetoes. The candidate confirms all
windows twice and rechecks the window set before skipWaiting. Hidden windows do
not initiate or execute a reload. A responsive idle hidden library may approve
controller handover and keep its old resources until it returns to the foreground;
a frozen or busy window never grants permission by silence. If a window is busy or silent, keep the prepared
release and reassess when safe, without repeatedly interrupting the user.

New pages check their own shell on BFCache/foreground restoration and Vite chunk
load failure. A missing shell may reload only at an existing safe route with no
active work and a verified complete active replacement. Reader/editor navigation
must finish normally first; durable-but-unsynced drafts need not upload before
reload. Record an attempt per target build in sessionStorage before reloading to
prevent loops. A missing response, unavailable storage, offline state or absent
replacement is not permission to reload. Legacy pages rely on the fixed v1 set,
not on restore code that they do not contain.

See [research and evidence](../research/pwa-update-lifecycle-sources.md) for browser
behavior boundaries; Chromium's activation eviction of BFCache is not a blanket
Safari guarantee. No business database migration is part of this decision.

Candidate-only status has a positive seal in the public registry. Activation or
navigation deletes that seal before serving the document; deletion frees space
and does not require an activation-metadata rewrite at quota. Missing timestamps
are never proof that a shell was unused: a failed activation metadata put must
not allow unknown-window GC to delete a displayed release. Losing a seal is
conservative (potentially displayed), not permission for abandoned-candidate GC.

## 2026-10-28 update discovery and slow preparation

Issue #613; complete discovery/permission failover is tracked separately in #614.

Visible online pages check on startup, foreground return and reconnection, and
at thirty-minute intervals during a continuous run. Lifecycle events share a
thirty-second minimum gap. A suppressed foreground/reconnection request remains
due after that gap rather than waiting another full interval. Failed checks,
registration and installation retry after 30 seconds, doubling to a thirty-minute
cap; successful checks reset backoff. Registration remounts retain the page's
schedule. Explicit checks bypass the delay. Hidden/offline pages do not run the
periodic check, and existing prepared updates retain their handover feedback.
Checking/downloading may happen in a reader; none of these events bypass the
existing route, interaction, task or multi-window gates for activation/reload.
Automatic handover now requires one second without interaction rather than three;
new interaction restarts that second. The page evaluates readiness every 250 ms so
it can respond promptly after the threshold rather than waiting another full
second. Manual handover still bypasses only idle time.

The install observer uses the same five-minute budget as a candidate download
attempt for its slow-preparation notice. Elapsed time alone never reports an
installation failure or detaches the observer: final verification/storage and a
quota recovery attempt may still be running. Only the worker's terminal state
settles preparation. A failed or timed-out fresh check also preserves an already
waiting release's update action. No message protocol, stored format, business
schema or deployed-client migration changes are needed.

The two network entries are not interchangeable release-selection authorities.
Immutable public release bytes keep their existing verified network failover.
`/sw.js` discovery and `/api/client-release` confirmation remain on the page's
origin: ADR-0021's HttpOnly channel Cookie is authoritative there. Neither another
origin's default channel nor a remembered local choice can grant admission when
that origin is unavailable. Full discovery/permission failover needs a separate
design preserving server-confirmed channel intent, expiry and origin-scoped SW
registration; periodic retry does not claim to solve that availability boundary.
