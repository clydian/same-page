# Stable and beta frontend release channels

Issue #539. Date: 2026-10-22. Extends ADR-0020 without changing business storage.

Use one origin, one `/sw.js` registration with root scope, one compatible backend and
one business IndexedDB. A durable HttpOnly channel Cookie defaults to stable. Its
server readback is authoritative online. A separately owned public shell receipt
permits offline display of the last successfully activated complete release; neither
pending preference nor a waiting candidate grants display permission.

Frontend artifacts live in a dedicated private R2 bucket at immutable build-prefixed
paths. A full SHA identifies exactly one sealed artifact. The uploader claims the
complete inventory before writing resources, conditionally creates every key and
seal, and verifies readback. A retry must reuse original bytes; rebuilding the same
SHA with new timestamps is a collision. D1 records the seal digest, readiness and
CAS-protected stable/beta pointers. Stable promotion rechecks independently granted
release authority and the authenticated live session in a trigger which atomically
commits the audit record and pointer change. No product membership or XML authority
implicitly grants release authority.

Worker-first routing keeps HTML, SW and dynamic legacy manifests private/no-store;
fixed frontend resources are immutable and missing files never become SPA HTML.
The worker attaches security headers itself. Canonical cached `/` is repaired from
its own immutable index URL, independently of the selected target. Candidate install,
manual handover, activation and navigation enforce admission. Browser auto-activation
without clients grants no exception. Existing cross-window vetoes continue to apply.

The initial storage contract fingerprints the transitive storage/sync implementation,
Dexie version and server migrations. Beta admission rejects differences against the
actual stable artifact. This deliberately conservative first phase cannot introduce
schema or sync representation changes. A future compatibility bridge requires a
separate reviewed change; no override flag waives this gate. App-shell updates never
copy, clear or downgrade business data.

No frontend object TTL or automatic server GC in this phase. Browser-owned caches
continue ADR-0020 retention. Retiring server versions requires a separate supported
client/resource policy. Native APK releases remain separate.

This code ships with channel routing disabled for the controlled bridge transition.
Enabling it requires a separately authorized rollout, provisioned bucket, recorded
stable baseline and offline/mobile validation. It must never deploy automatically
as part of local development or review.
