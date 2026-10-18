# Version application shells independently of deployed and waiting workers

A running legacy worker, a waiting release and another installing release can coexist.
Workbox's shared precache activation removes another installer's already-written
entries. An index cache miss then follows the host's index.html redirect, which
cannot be returned as a navigation response. This can produce a native ERR_FAILED.

## Invariants

- Each immutable manifest has its own scope-qualified `same-page-shell-v1:` cache.
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
  are never shell fallbacks. Existing explicit multi-window update vetoes remain.
- Only owned cache names are collected. Worker identities and page build probes
  protect installing/waiting/active and displayed versions; unknown/suspended
  clients veto collection. Keep one additional complete rollback release and a 24-hour grace for activated releases (including history/BFCache). Web Locks serialize admission leases and deletion; without this API collection is deferred, never guessed. Take a
  fixed candidate snapshot and recheck live references before deletion. Legacy
  caches, PDF/annotation databases and runtime animation caches are never collected.
- Owned shells have a bounded admission budget (four 7 MiB manifests). An active
  worker may collect unused releases first; if protected/unknown clients or quota
  prevent admission, installation fails safely, retaining the existing update.

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
