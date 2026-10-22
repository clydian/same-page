# Stable and beta frontend release channels

Issue #539. Date: 2026-10-22. Extends ADR-0020 without changing business storage.

The registry is one record containing pending choice, server confirmation and last
permitted display. Selection and activation serialize through the same Web Lock;
online reconciliation consumes interrupted pending state without recreating Cookies.
New navigations consult server authority and only reuse an older permitted fallback
within the same channel; Cookie expiry from beta to default stable cannot restore beta.

Use one origin, one `/sw.js` registration with root scope, one compatible backend and
one business IndexedDB. A durable HttpOnly channel Cookie defaults to stable. Its
server readback is authoritative online. A separately owned public shell receipt
permits offline display of the last successfully activated complete release; neither
pending preference nor a waiting candidate grants display permission.
An already permitted complete shell in the same channel remains readable when
refreshing its receipt fails at quota; first permission for a different shell or
channel still requires a successful durable write. Offline UI identifies the
running channel from that build's permitted receipt, without restoring a Cookie
or treating local metadata as online authority.
If both channels select the already-permitted running build, confirmed online
readback may update its channel attribution without a reload or a new display grant.

The about page combines channel selection, running version and update feedback.
Ordinary updates within a channel retain normal update wording. Product operators
enter the existing backend from the personal menu only after server confirmation;
drive ownership does not confer backend or release authority. Release tables,
promotion confirmation and audit history display the original version from the
sealed build.json; hashes remain internal identities and collapsed diagnostics.
Missing version metadata is explicit, never reconstructed from upload time.

A prepared handover explicitly deferred by other windows may show one polite
reminder per waiting worker in the current page lifetime. It appears only in a
visible, idle drive file library after at least ten seconds of deferral, dismisses
after eight seconds (paused during hover/focus), and links to the about page.
Readers, playback, operations, inputs and overlays keep their existing vetoes.
Resource failures and unknown handover failures do not trigger this reminder.
The reminder never bypasses or holds the update safety gate.

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

For the current small user base and rapid iteration, the storage gate checks a
small explicit set of business IndexedDB and shared sync representation boundaries
listed in `scripts/release-contract.mjs`, plus Dexie and Zod versions. It does not freeze all callers, UI implementation or
server migrations. This replaces the original transitive-source fingerprint, which
also rejected harmless UI changes. Existing sealed artifacts remain immutable;
comparison can read the same boundary entries from an older broad inventory.
A private probe built from each sealed artifact also runs actual draft/queue/push/pull
mergers and a Blob/outbox/conflict/owner fixture through stable → beta → stable → beta
in isolated Chromium and WebKit persistent profiles. The report binds both probe
digests and the current stable target; beta admission and stable promotion require
this recorded proof. The probes use parsed protocol responses; SQL/API validation
remains in the Worker integration suite. Neither the private probes nor reports are
served through the frontend file inventory.

Beta admission compares those boundaries against the actual stable artifact and
requires the artifact round trip above. UI changes, compatible backend changes and
ordinary bug fixes can proceed without a new bridge. Business schema and shared
sync representation changes still require a reviewed compatibility bridge; no
override flag waives this gate. App-shell updates never copy, clear or downgrade
business data.

An incident operator may stop distributing a faulty beta by moving only beta back
to the current ready stable release with an exact expected-beta/revision CAS. This
uses the existing controlled operations CLI, adds no history picker, and leaves
stable, artifacts and business data unchanged. Pause CI while doing this and record
the operator, reason and before/after pointers in the incident record. Cached and
offline clients cannot be immediately recalled; resumed normal CI admits a later
verified repair commit through the usual gates, without readmitting the faulty SHA.

No frontend object TTL or automatic server GC in this phase. Browser-owned caches
continue ADR-0020 retention. Retiring server versions requires a separate supported
client/resource policy. Native APK releases remain separate.

This code ships with channel routing disabled for the controlled bridge transition.
Enabling it requires a separately authorized rollout, provisioned bucket, recorded
stable baseline and offline/mobile validation. It must never deploy automatically
as part of local development or review.
