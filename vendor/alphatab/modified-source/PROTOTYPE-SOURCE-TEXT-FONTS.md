# Source text generic font families (SamePage #501)

This unversioned source change extends `SourceText` with optional `fontFamilies`.
It preserves ordered generic CSS fallback families through the public JSON model
used by the render Worker, then passes that list to `Font.withFamilyList`.
Supported entries are `serif`, `sans-serif`, `monospace`, `cursive`, `fantasy`,
and `system-ui`. The source adapter normalizes generic names to lower case.
Named or quoted custom fonts are outside this contract. Invalid lists are not
painted; the caller must keep its existing atomic fallback policy.

Omitting the field preserves the existing configured font behavior. Font size,
style, weight, placement, declaration order and independent same-time text lanes
retain their existing behavior. This is a display extension: no score notes,
MIDI, playback timing or source MusicXML bytes are changed. It does not add
rotation, enclosure, custom-font loading, or general MusicXML style support.

The owned regression uses two simultaneous serif instructions, `SOLO or Div.`
and `gently`. Both must survive prepared-data structured cloning and Worker JSON
and be visible in actual SVG. The corresponding Sun measure 65 is tested through
real Session preparation/render Workers in Chromium and WebKit. This is source
build evidence, not a released archive or production acceptance.

Issue: https://github.com/clydian/same-page/issues/501
