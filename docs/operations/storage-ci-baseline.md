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

## Verification and recovery

The one-time rollout fixture and absent-route bridge have been removed. Every CI
run now requires the live endpoint; there is no local baseline fallback or fixture
to rotate. `artifacts/verification/release-storage/reviewed-baseline.json` must say
`baselineSource: current-stable` and report passing Chromium and WebKit engines.
The cleanup PR itself runs this complete matrix after the endpoint deployment.

The existing main deployment path still checks the actual current stable and
admits beta as before. It does not promote stable or change user data, production
artifacts or their retention policy.

If the endpoint is unavailable, including an absent-route 404, CI stops. Repair the
endpoint through the normal deployment/revert workflow; do not skip the check,
replace it with candidate self-testing or regenerate an old build. A Worker rollback
must preserve this endpoint. If rolling back to pre-endpoint code is necessary,
restore the reviewed bridge from Git history as part of that recovery before running
CI; the historical bridge is valid only while stable is exactly aa604ba. Ordinary
frontend beta-to-stable rollback does not remove the Worker endpoint.

The original one-time fixture remains recoverable in Git history, but no subsequent
stable release adds a new fixture. This cleanup removes only repository test assets
and their fallback code; it does not delete R2 objects or user data.
