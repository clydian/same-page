# CI storage baseline

## Permanent source and replacement

CI reads `https://samepage.clyapps.com/api/release-storage-baseline` without cookies,
production secrets or a GitHub Actions artifact download. The Worker reads the
current `stable` pointer once, verifies its existing D1-pinned R2 seal and both
original `storage.json` / `storage-probe.js` digests, then returns those two strings
and their digests. The probe is synthetic code built from this public repository;
it contains no user records or credentials. Only this current-stable read is public.
The R2 bucket, historical keys and production credentials remain private.

A stable promotion automatically replaces the source for the next CI run. Nothing
is uploaded or retained by this endpoint: no new R2 objects, versioned baseline
archives, scheduled sync, or deletion job. There is no growing baseline collection.
Existing full release artifacts have their separate supported-client retention
policy; this repair does not delete those resources or change that policy.

One request keeps the captured release's complete bytes even if stable changes
while it is being read. Missing/corrupt bytes fail with HTTP 503. There is no fallback
to beta or an older stable after such a failure. The current run may finish against
the captured stable; production upload still checks the actual stable under the
existing production lock, and admission/promotion retain their existing checks/CAS.
No new lock, pointer, publish step or rollback operation is introduced.

The reviewed boundary metadata in `scripts/release-storage-baseline.json` remains
an explicit source-contract guard. It is not the live baseline selector. A newer
stable with unchanged compatible boundaries does not require a metadata edit.
Schema/protocol/dependency changes still require a reviewed compatibility bridge.
The real Chromium + WebKit stable → candidate → stable → candidate matrix remains
mandatory and uses the sealed candidate bytes, never a reconstructed older build.

## One-time repair bridge

The PR implementing the endpoint must pass CI before its Worker can be deployed.
`scripts/fixtures/storage-bootstrap.json.gz` is one fixed 202,359-byte gzip containing
only the original seal, contract and probe from current stable:

- Source: `aa604ba541364591eab4b171aff85f96a9f7742f`
- Successful main CI: https://github.com/clydian/same-page/actions/runs/40797937497
- Original artifact: `12864467066`, `release-aa604ba541364591eab4b171aff85f96a9f7742f`
- GitHub ZIP SHA256: `f9be7df7619a7f3633e76b87c8816d0e8eb71e3257cd7925b1256c68786d9862`
- GitHub expiry: 2026-11-12 01:03:18 UTC, irrelevant after this original subset is saved
- Restored ZIP digest matched GitHub and all 339 files passed the original release
  seal before extracting this subset. Runtime additionally checks the pinned seal
  digest, source SHA, run ID and both original file digests.

This bridge is allowed only when the endpoint returns the existing absent-route
`404 {"error":"not_found"}` and a fresh cookie-free `/api/client-release` response
still selects **exactly** this stable and contract. Any stable change, timeout,
redirect, malformed body, corruption or other HTTP error fails closed. The live
endpoint takes precedence as soon as it exists. Do not regenerate this fixture for
future stable versions. It is a single bounded bootstrap, not a release archive.

## Rollout and recovery

1. Merge this repair only after its required CI checks pass. The first PR/main run
   uses the verified bridge if the endpoint is still absent. No compatibility check
   is skipped and no production credentials are added to PR jobs.
2. The existing main deployment path publishes the Worker, runs its current-stable
   compatibility checks, and admits beta as before. The fix does not enable a paused
   release flag, promote stable, or otherwise bypass production authorization.
3. Verify the endpoint returns 200 and the current stable build ID. In the next CI
   `reviewed-baseline.json` must say `baselineSource: current-stable` and list both
   engines. This is the evidence that recovery is using the permanent source.
4. After that deployment is confirmed and rollback no longer needs the old Worker,
   remove the bootstrap gzip and the explicit 404 bridge in a small follow-up PR.
   Do not replace them with another version. Git retains the one historical small
   fixture, but subsequent stable releases never add probe bundles to Git.

If publication fails, the existing stable and its R2 data remain untouched. Repair
or retry the normal deployment; do not overwrite sealed objects or turn a failed
baseline check green. Rolling back the Worker to pre-endpoint code only permits the
bridge while stable is still aa604ba; after a later stable promotion CI correctly
blocks until the endpoint is restored. No baseline resources need destructive GC.
