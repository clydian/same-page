# Additional investigations (no behavior changes)

## "Attachment updated"

Read the selected attachment -> fresh schema-validated metadata -> downloaded
file version chain at musicxml-source.ts. The only attachmentUpdated throws are:
- fresh id/score/kind/revision/size/trash differs from the selected attachment;
- a syntactically valid, positive safe-integer X-Attachment-Revision differs
  from the fresh metadata revision.

Missing/hidden/malformed version headers produce attachmentRevisionMissing.
Malformed JSON/schema, length mismatch, parse/player failure do not become
attachmentUpdated. Temporary metadata/file transport failures use the existing
full offline eligibility gate; 401/403/404 revoke access, without an offline
bypass. A fresh focus check only revokes on authoritative denial; a transient
failure does not revoke a loaded player. The file request carries revision and
attachment diagnostic headers; diagnosticFetch delegates to connectionFetch,
which preserves returned responses and route/identity checks.

Ran musicxml-source.test.ts, musicxml-opening.test.ts and
use-playback-lifetime.test.tsx: 58 passed with controlled responses, including
missing/malformed revision, actual revision change, metadata changes, corrupt
cache/length, network/503 and denied access. Existing #626/CORS behavior was not
reimplemented. No confirmed current-main misclassification was found. No
production root cause was established; production browser/network version and
actual response evidence are still absent. No production writes or extra retry.

## Per-part timbre override

Inspected the actual installed sonivox.sf2 bytes (1,351,896 bytes, RIFF sfbk),
SHA256 4978cf37e7164206f2d22dc4fdf4020ffe040787210bf781e31bdc79961f59ef.
SF2 phdr lists 132 presets, including bank 0 program 0 Piano 1, 4 E.Piano 1,
52 Choir Aahs, 53 Voice Oohs, 54 SynVox. These are verified preset headers,
not a claim of auditory validation of every preset.

assignPlaybackChannels assigns one melodic channel per track (shared across its
staves; primary and secondary identical); percussion uses channel 9 and a
second independent percussion track is rejected. Opus reuses the synth while
loading each piece's precomputed MIDI and resetting channel states.

The exposed IAlphaSynth/AlphaSynthBase surface offers channel volume/mute/solo/
transposition, but no persistent per-channel program override. Program changes
are baked into MIDI. In addition, session opening calls applyTimbreProfile,
which overwrites recognized vocal tracks' program/bank and instrument automation
before loading. Merely changing playbackInfo or exposing a select cannot both
change the current loaded MIDI and restore true source values. Reliably adding
this requires retaining per-piece original programs/automations, altering MIDI
preparation/reload and replaying transport/mix/loop state. That path has not been
implemented or validated as a small change. No placeholder UI, new synth API,
user-scoped timbre persistence, upload modification or listening claim was added.
