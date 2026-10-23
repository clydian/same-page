# Beta admission network failure

## Evidence

- After #568 merged, CI [39988201938](https://github.com/clydian/same-page/actions/runs/39988201938) passed all test/build/verify jobs. Deploy uploaded immutable frontend bytes, deployed Worker version `0f9c0939-7f76-4503-a0f3-4ea2e2a21bc5`, and passed `verify:deployment` for `52da51b3f6a3325cc96ac29104793c05fad332ba`.
- `Admit verified frontend to beta` then failed after about 18 seconds with an unlabelled `DOMException [TimeoutError]`. The historical log does not identify the endpoint or file. Its exact request and upstream cause cannot be recovered from this log.
- Read-only production checks showed backend `52da51b3…`, with both stable and beta still targeting `521b3469…`, channel revision 4. A deployed backend does not prove beta admission.
- Injecting a timeout into the actual admission CLI's token-verification read reproduces the exception before any artifact/catalog writes. This establishes a vulnerable path, not proof that this endpoint was the historical source.

## Repair and boundaries

Explicit safe reads retry at most three times, with fresh per-attempt deadlines and 1/2 second backoff. The deadline covers response-body consumption. Retryable failures are fetch network/timeout errors and HTTP 429/500/502/503/504. Errors identify the stage or candidate file and attempt count without raw response bodies, credentials or raw exception messages.

Token verification retries the same owner endpoint; only the existing authentication-rejection rules permit switching owner endpoints. D1 SQL reads opt in; mutations never retry after an ambiguous response. Backend identity, every resource hash, compatibility proof and channel CAS remain required. Persistent network failures still prevent admission. This does not rebuild/rewrite the original artifact, promote stable, or change user data.

## Validation

- Regression first failed on the production `deriveR2Credentials` timeout path, then passed with bounded same-endpoint recovery.
- Node 24: 342 Node unit tests; 15 Android publication boundary tests; lint and whitespace checks passed.
- Request tests include a real local HTTP response that stalls after headers, plus permanent HTTP failures, bounded exhaustion, body disconnects, lost mutation responses, malformed JSON and redacted diagnostics.
- Online candidate verification checks every original sealed file; a passing read-only check does not itself change channel pointers.
