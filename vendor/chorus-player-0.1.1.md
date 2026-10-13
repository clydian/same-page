# Chorus Player 0.1.1

Source: `clydian/chorus-score-studio`, branch `codex/same-page-playback-session`, commit `aacfdb2`.

Build/pack: Node 24, `npm ci`, `npm pack --workspace @clydian/chorus-player`.
The tarball is pinned through `package-lock.json`; production does not load from an adjacent checkout or call Chorus.

This version adds optional scroll-container/follow behavior and host-owned prepared-input reuse, preserves independent faders through temporary focus, exposes selected/other volume groups, and distinguishes duplicate track names. `createPlayerSession(container, bytes)` remains supported; the options argument is additive.

Prepared content is private host data. Same Page owns fresh authorization/revision verification, memory limits, expiry and session/access-loss eviction. A cached preparation never grants access or creates an offline attachment copy.
