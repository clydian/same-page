import * as alphaTab from "@coderline/alphatab";

import type { MusicXmlDynamicEvent, MusicXmlWedgeEvent } from "./musicxml-direction-timing.ts";

const HIDDEN_DYNAMIC = -1 as alphaTab.model.DynamicValue;
const DEFAULT_UNMARKED_DYNAMIC = alphaTab.model.DynamicValue.MF;

const dynamicLadder = [
  alphaTab.model.DynamicValue.PPP,
  alphaTab.model.DynamicValue.PP,
  alphaTab.model.DynamicValue.P,
  alphaTab.model.DynamicValue.MP,
  alphaTab.model.DynamicValue.MF,
  alphaTab.model.DynamicValue.F,
  alphaTab.model.DynamicValue.FF,
  alphaTab.model.DynamicValue.FFF,
] as const;

const dynamicRank = (dynamic: alphaTab.model.DynamicValue): number => {
  const exact = dynamicLadder.indexOf(
    dynamic as (typeof dynamicLadder)[number],
  );
  if (exact >= 0) {
    return exact;
  }

  switch (dynamic) {
    case alphaTab.model.DynamicValue.PPPP:
    case alphaTab.model.DynamicValue.PPPPP:
    case alphaTab.model.DynamicValue.PPPPPP:
    case alphaTab.model.DynamicValue.N:
      return 0;
    case alphaTab.model.DynamicValue.FFFF:
    case alphaTab.model.DynamicValue.FFFFF:
    case alphaTab.model.DynamicValue.FFFFFF:
    case alphaTab.model.DynamicValue.SFFZ:
      return dynamicLadder.length - 1;
    case alphaTab.model.DynamicValue.SF:
    case alphaTab.model.DynamicValue.SFP:
    case alphaTab.model.DynamicValue.SFPP:
    case alphaTab.model.DynamicValue.FP:
    case alphaTab.model.DynamicValue.RF:
    case alphaTab.model.DynamicValue.RFZ:
    case alphaTab.model.DynamicValue.SFZ:
    case alphaTab.model.DynamicValue.FZ:
    case alphaTab.model.DynamicValue.PF:
    case alphaTab.model.DynamicValue.SFZP:
      return dynamicLadder.indexOf(alphaTab.model.DynamicValue.F);
    default:
      return dynamicLadder.indexOf(DEFAULT_UNMARKED_DYNAMIC);
  }
};

const dynamicAtRank = (rank: number): alphaTab.model.DynamicValue =>
  dynamicLadder[Math.max(0, Math.min(dynamicLadder.length - 1, rank))];

const musicXmlDynamic = (value: string): alphaTab.model.DynamicValue | null => {
  const key = value.replace(/[^a-z]/giu, "").toLowerCase();
  const values: Record<string, alphaTab.model.DynamicValue> = {
    f: alphaTab.model.DynamicValue.F,
    ff: alphaTab.model.DynamicValue.FF,
    fff: alphaTab.model.DynamicValue.FFF,
    ffff: alphaTab.model.DynamicValue.FFFF,
    fffff: alphaTab.model.DynamicValue.FFFFF,
    ffffff: alphaTab.model.DynamicValue.FFFFFF,
    fp: alphaTab.model.DynamicValue.FP,
    fz: alphaTab.model.DynamicValue.FZ,
    mf: alphaTab.model.DynamicValue.MF,
    mp: alphaTab.model.DynamicValue.MP,
    n: alphaTab.model.DynamicValue.N,
    p: alphaTab.model.DynamicValue.P,
    pf: alphaTab.model.DynamicValue.PF,
    pp: alphaTab.model.DynamicValue.PP,
    ppp: alphaTab.model.DynamicValue.PPP,
    pppp: alphaTab.model.DynamicValue.PPPP,
    ppppp: alphaTab.model.DynamicValue.PPPPP,
    pppppp: alphaTab.model.DynamicValue.PPPPPP,
    rf: alphaTab.model.DynamicValue.RF,
    rfz: alphaTab.model.DynamicValue.RFZ,
    sf: alphaTab.model.DynamicValue.SF,
    sffz: alphaTab.model.DynamicValue.SFFZ,
    sfp: alphaTab.model.DynamicValue.SFP,
    sfpp: alphaTab.model.DynamicValue.SFPP,
    sfz: alphaTab.model.DynamicValue.SFZ,
    sfzp: alphaTab.model.DynamicValue.SFZP,
  };
  return values[key] ?? null;
};

const setNoteDynamics = (
  beat: alphaTab.model.Beat,
  dynamic: alphaTab.model.DynamicValue,
): void => {
  for (const note of beat.notes) {
    note.dynamics = dynamic;
  }
};

const beatsByVoice = (staff: alphaTab.model.Staff): alphaTab.model.Beat[][] => {
  const voiceCount = staff.bars.reduce(
    (count, bar) => Math.max(count, bar.voices.length),
    0,
  );
  return Array.from({ length: voiceCount }, (_, voiceIndex) =>
    staff.bars.flatMap((bar) => bar.voices[voiceIndex]?.beats ?? []),
  );
};

const firstSoundingBeat = (
  beats: alphaTab.model.Beat[],
  start: number,
): alphaTab.model.Beat | null => {
  for (let index = start; index < beats.length; index += 1) {
    if (beats[index].notes.length > 0) {
      return beats[index];
    }
  }
  return null;
};

const gradualWordDirection = (text: string): 1 | -1 | null => {
  const normalized = text.toLowerCase().replace(/\s+/gu, " ").trim();
  let diminuendo = false;
  for (const match of normalized.matchAll(
    /\b(cresc|crescendo|dim|diminuendo|decresc|decrescendo)\b/gu,
  )) {
    // "non dim." negates this instruction, not every gradual word in the
    // direction. In "dim. non troppo", non qualifies troppo, so dim remains.
    const prefix = normalized.slice(0, match.index);
    if (/\bnon\s+$/u.test(prefix)) continue;
    // Preserve the existing crescendo precedence for mixed affirmative text.
    if (match[0].startsWith("cresc")) return 1;
    diminuendo = true;
  }
  return diminuendo ? -1 : null;
};

interface TimedBeat {
  absoluteStart: number;
  beat: alphaTab.model.Beat;
}

const timedTrackBeats = (track: alphaTab.model.Track): TimedBeat[] => {
  const seen = new Set<number>();
  const timed: TimedBeat[] = [];
  for (const staff of track.staves) {
    for (const bar of staff.bars) {
      for (const voice of bar.voices) {
        for (const beat of voice.beats) {
          if (seen.has(beat.id)) {
            continue;
          }
          seen.add(beat.id);
          timed.push({
            absoluteStart: bar.masterBar.start + beat.playbackStart,
            beat,
          });
        }
      }
    }
  }
  return timed.sort(
    (left, right) =>
      left.absoluteStart - right.absoluteStart || left.beat.id - right.beat.id,
  );
};

const partWidePlaybackStaff = (
  track: alphaTab.model.Track,
  events: MusicXmlDynamicEvent[],
): number | null => {
  const explicitlyScopedStaves = new Set(
    events.flatMap((event) => (event.staff === null ? [] : [event.staff])),
  );
  if (
    track.staves.length <= 1 ||
    explicitlyScopedStaves.size !== 1 ||
    !events.every((event) => event.staff !== null && event.voice === null)
  ) {
    return null;
  }
  return [...explicitlyScopedStaves][0] - 1;
};

interface TimedDynamicEvent {
  absoluteStart: number;
  dynamic: alphaTab.model.DynamicValue;
  event: MusicXmlDynamicEvent;
  sourceIndex: number;
}

const timedSourceDynamicEvents = (
  track: alphaTab.model.Track,
  events: MusicXmlDynamicEvent[],
): TimedDynamicEvent[] =>
  events
    .flatMap((event, sourceIndex) => {
      const bar = track.score.masterBars[event.measureIndex];
      const dynamic = musicXmlDynamic(event.value);
      return bar && dynamic !== null
        ? [
            {
              absoluteStart: bar.start + event.quarter * 960,
              dynamic,
              event,
              sourceIndex,
            },
          ]
        : [];
    })
    .sort(
      (left, right) =>
        left.absoluteStart - right.absoluteStart ||
        left.sourceIndex - right.sourceIndex,
    );

const sourceDynamicMatches = (
  candidate: TimedDynamicEvent,
  beat: alphaTab.model.Beat,
  ignoreStaff: boolean,
): boolean => {
  const { event } = candidate;
  const numericVoice = Number(event.voice);
  return (
    (ignoreStaff ||
      event.staff === null ||
      event.staff === beat.voice.bar.staff.index + 1) &&
    (event.voice === null ||
      (Number.isFinite(numericVoice) && numericVoice === beat.voice.index + 1))
  );
};

/** Same rule for carried values, explicit onsets and gradual-word endpoints:
 * latest time, then most specific scope, then last source declaration. */
const effectiveSourceDynamic = (
  events: TimedDynamicEvent[],
  beat: alphaTab.model.Beat,
  absoluteStart: number,
  ignoreStaff: boolean,
  exact = false,
): TimedDynamicEvent | null => {
  let selected: TimedDynamicEvent | null = null;
  const specificity = (candidate: TimedDynamicEvent) =>
    (candidate.event.staff === null ? 0 : 1) +
    (candidate.event.voice === null ? 0 : 2);
  for (const candidate of events) {
    if (candidate.absoluteStart > absoluteStart) break;
    if (
      (exact && candidate.absoluteStart !== absoluteStart) ||
      !sourceDynamicMatches(candidate, beat, ignoreStaff)
    )
      continue;
    if (
      selected === null ||
      candidate.absoluteStart > selected.absoluteStart ||
      (candidate.absoluteStart === selected.absoluteStart &&
        (specificity(candidate) > specificity(selected) ||
          (specificity(candidate) === specificity(selected) &&
            candidate.sourceIndex > selected.sourceIndex)))
    )
      selected = candidate;
  }
  return selected;
};

const applySourceDynamicEvents = (
  track: alphaTab.model.Track,
  events: MusicXmlDynamicEvent[],
): number => {
  const usePartWidePlayback = partWidePlaybackStaff(track, events) !== null;
  const timedEvents = timedSourceDynamicEvents(track, events);
  let adjustedNotes = 0;
  for (const { absoluteStart, beat } of timedTrackBeats(track)) {
    const visualEvent = effectiveSourceDynamic(
      timedEvents,
      beat,
      absoluteStart,
      false,
    );
    const playbackEvent = usePartWidePlayback
      ? effectiveSourceDynamic(timedEvents, beat, absoluteStart, true)
      : visualEvent;
    beat.dynamics = visualEvent?.dynamic ?? HIDDEN_DYNAMIC;
    const noteDynamic = playbackEvent?.dynamic ?? DEFAULT_UNMARKED_DYNAMIC;
    for (const note of beat.notes) {
      if (note.dynamics !== noteDynamic) adjustedNotes += 1;
      note.dynamics = noteDynamic;
    }
  }
  return adjustedNotes;
};

const restoreSourceDynamicOnsets = (
  track: alphaTab.model.Track,
  events: MusicXmlDynamicEvent[],
): void => {
  const partWide = partWidePlaybackStaff(track, events) !== null;
  const timedEvents = timedSourceDynamicEvents(track, events);
  for (const { absoluteStart, beat } of timedTrackBeats(track)) {
    const event = effectiveSourceDynamic(
      timedEvents,
      beat,
      absoluteStart,
      partWide,
      true,
    );
    if (event) setNoteDynamics(beat, event.dynamic);
  }
};

/** Playback has already consumed carried values. Restore source notation only.
 * Exact beats retain their native flags; a bar with no exact staff beat uses a
 * complete independent-time list instead of inventing or retiming a beat.
 * Explicit above placement also uses that list so the native upper band retains
 * authored side without transferring the event to a neighboring attack. */
const restoreSourceDynamicGlyphs = (
  track: alphaTab.model.Track,
  events: MusicXmlDynamicEvent[],
): void => {
  if (events.length === 0) return;
  const selected = new Map<alphaTab.model.Beat, alphaTab.model.DynamicValue>();
  const byBar = new Map<alphaTab.model.Bar, {
    declarations: alphaTab.model.SourceDynamic[];
    independent: boolean;
  }>();
  for (const event of events) {
    const dynamic = musicXmlDynamic(event.value);
    const staffIndex = (event.staff ?? 1) - 1;
    const voiceIndex = event.voice === null ? null : Number(event.voice) - 1;
    if (dynamic === null || !Number.isSafeInteger(staffIndex) || staffIndex < 0 ||
      (voiceIndex !== null && (!Number.isSafeInteger(voiceIndex) || voiceIndex < 0))) return;
    const bar = track.staves[staffIndex]?.bars[event.measureIndex];
    if (!bar || !Number.isFinite(event.quarter) || event.quarter < 0 ||
      event.quarter * 960 > bar.masterBar.calculateDuration() ||
      (voiceIndex !== null && !bar.voices[voiceIndex])) return;
    const candidates = bar.voices.flatMap(voice =>
      voiceIndex !== null && voice.index !== voiceIndex ? [] : voice.beats.filter(beat =>
        beat.playbackStart / 960 === event.quarter));
    const beat = candidates.find(candidate => !candidate.isEmpty) ?? candidates[0];
    if (beat && selected.has(beat)) return;
    if (beat) selected.set(beat, dynamic);
    else if (bar.voices.some(voice => voice.beats.some(candidate =>
      candidate.displayStart !== candidate.playbackStart || candidate.graceType !== alphaTab.model.GraceType.None))) return;
    const entry = byBar.get(bar) ?? { declarations: [], independent: false };
    entry.declarations.push(Object.assign(new alphaTab.model.SourceDynamic(), {
      displayStart: event.quarter * 960,
      value: dynamic,
      ...(event.placement ? { placement: event.placement === "above"
        ? alphaTab.model.SourceDynamicPlacement.Above : alphaTab.model.SourceDynamicPlacement.Below } : {}),
    }));
    entry.independent ||= !beat || event.placement === "above";
    byBar.set(bar, entry);
  }
  // Validate the whole track before clearing anything. An independent band
  // cannot represent conflicting simultaneous symbols on separate voice lanes.
  for (const entry of byBar.values()) {
    if (entry.independent && new Set(entry.declarations.map(d => d.displayStart)).size !== entry.declarations.length) return;
  }
  for (const staff of track.staves) for (const bar of staff.bars) {
    const entry = byBar.get(bar);
    if (entry?.independent) bar.sourceDynamics = entry.declarations;
    for (const voice of bar.voices) for (const beat of voice.beats) {
      beat.dynamics = selected.get(beat) ?? HIDDEN_DYNAMIC;
      beat.isDynamicsExplicit = selected.has(beat);
    }
  }
};

const applyRampToTimedBeats = ({
  beats,
  onsetBeats = beats,
  end,
  hasExplicitTarget,
  start,
  startRank,
  targetRank,
}: {
  beats: TimedBeat[];
  onsetBeats?: TimedBeat[];
  end: number;
  hasExplicitTarget: boolean;
  start: number;
  startRank: number;
  targetRank: number;
}): number => {
  const sounding = beats.filter(
    ({ absoluteStart, beat }) =>
      absoluteStart >= start && absoluteStart < end && beat.notes.length > 0,
  );
  const onsets = [
    ...new Set(
      onsetBeats
        .filter(
          ({ absoluteStart, beat }) =>
            absoluteStart >= start &&
            absoluteStart < end &&
            beat.notes.length > 0,
        )
        .map(({ absoluteStart }) => absoluteStart),
    ),
  ];
  if (onsets.length === 0) {
    return 0;
  }
  const onsetIndex = new Map(onsets.map((onset, index) => [onset, index]));

  let adjustedNotes = 0;
  for (const { absoluteStart, beat } of sounding) {
    const index = onsetIndex.get(absoluteStart) ?? 0;
    const progress = hasExplicitTarget
      ? index / onsets.length
      : onsets.length === 1
        ? 0
        : index / (onsets.length - 1);
    const rank = Math.round(startRank + (targetRank - startRank) * progress);
    setNoteDynamics(beat, dynamicAtRank(rank));
    adjustedNotes += beat.notes.length;
  }
  return adjustedNotes;
};

const applyHairpinsToVoice = (beats: alphaTab.model.Beat[]): number => {
  let adjustedNotes = 0;
  let index = 0;

  while (index < beats.length) {
    const hairpin = beats[index].crescendo;
    if (hairpin === alphaTab.model.CrescendoType.None) {
      index += 1;
      continue;
    }

    const runStart = index;
    while (index < beats.length && beats[index].crescendo === hairpin) {
      index += 1;
    }
    const runEnd = index;
    const soundingBeats = beats
      .slice(runStart, runEnd)
      .filter((beat) => beat.notes.length > 0);
    if (soundingBeats.length === 0) {
      continue;
    }

    const firstBeat = soundingBeats[0];
    const firstNoteDynamic = firstBeat.notes[0]?.dynamics;
    const startDynamic =
      firstBeat.dynamics === HIDDEN_DYNAMIC
        ? (firstNoteDynamic ?? DEFAULT_UNMARKED_DYNAMIC)
        : firstBeat.dynamics;
    const startRank = dynamicRank(startDynamic);
    const direction =
      hairpin === alphaTab.model.CrescendoType.Crescendo ? 1 : -1;
    const endpoint = firstSoundingBeat(beats, runEnd);
    const endpointRank = endpoint ? dynamicRank(endpoint.dynamics) : startRank;
    const hasExplicitTarget =
      endpoint !== null &&
      endpoint.dynamics !== HIDDEN_DYNAMIC &&
      (endpointRank - startRank) * direction > 0;
    const targetRank = hasExplicitTarget
      ? endpointRank
      : Math.max(0, Math.min(dynamicLadder.length - 1, startRank + direction));

    for (const [soundingIndex, beat] of soundingBeats.entries()) {
      const progress = hasExplicitTarget
        ? soundingIndex / soundingBeats.length
        : soundingBeats.length === 1
          ? 0
          : soundingIndex / (soundingBeats.length - 1);
      const rank = Math.round(startRank + (targetRank - startRank) * progress);
      const dynamic = dynamicAtRank(rank);
      setNoteDynamics(beat, dynamic);
      adjustedNotes += beat.notes.length;
    }
  }

  return adjustedNotes;
};

const applyPartWideHairpins = (
  track: alphaTab.model.Track,
  sourceStaffIndex: number,
): number => {
  const sourceStaff = track.staves[sourceStaffIndex];
  if (!sourceStaff) {
    return 0;
  }

  for (const [staffIndex, staff] of track.staves.entries()) {
    if (staffIndex === sourceStaffIndex) {
      continue;
    }
    for (const voiceBeats of beatsByVoice(staff)) {
      for (const beat of voiceBeats) {
        beat.crescendo = alphaTab.model.CrescendoType.None;
      }
    }
  }

  const timedBeats = timedTrackBeats(track);
  let adjustedNotes = 0;
  for (const sourceBeats of beatsByVoice(sourceStaff)) {
    let index = 0;
    while (index < sourceBeats.length) {
      const hairpin = sourceBeats[index].crescendo;
      if (hairpin === alphaTab.model.CrescendoType.None) {
        index += 1;
        continue;
      }

      const runStart = index;
      while (
        index < sourceBeats.length &&
        sourceBeats[index].crescendo === hairpin
      ) {
        index += 1;
      }
      const runEnd = index;
      const soundingBeats = sourceBeats
        .slice(runStart, runEnd)
        .filter((beat) => beat.notes.length > 0);
      if (soundingBeats.length === 0) {
        continue;
      }

      const firstBeat = soundingBeats[0];
      const start =
        firstBeat.voice.bar.masterBar.start + firstBeat.playbackStart;
      const startDynamic =
        firstBeat.notes[0]?.dynamics ?? DEFAULT_UNMARKED_DYNAMIC;
      const startRank = dynamicRank(startDynamic);
      const direction =
        hairpin === alphaTab.model.CrescendoType.Crescendo ? 1 : -1;
      const endpoint = firstSoundingBeat(sourceBeats, runEnd);
      const endpointDynamic = endpoint?.notes[0]?.dynamics ?? HIDDEN_DYNAMIC;
      const endpointRank = dynamicRank(endpointDynamic);
      const hasExplicitTarget =
        endpoint !== null &&
        endpointDynamic !== HIDDEN_DYNAMIC &&
        (endpointRank - startRank) * direction > 0;
      const targetRank = hasExplicitTarget
        ? endpointRank
        : Math.max(
            0,
            Math.min(dynamicLadder.length - 1, startRank + direction),
          );
      const lastBeat = soundingBeats.at(-1) ?? firstBeat;
      const end =
        endpoint && hasExplicitTarget
          ? endpoint.voice.bar.masterBar.start + endpoint.playbackStart
          : lastBeat.voice.bar.masterBar.start +
            lastBeat.playbackStart +
            lastBeat.playbackDuration;

      adjustedNotes += applyRampToTimedBeats({
        beats: timedBeats,
        end,
        hasExplicitTarget,
        start,
        startRank,
        targetRank,
      });
    }
  }
  return adjustedNotes;
};

const applyGradualWordsToTrack = (
  track: alphaTab.model.Track,
  sourceEvents: MusicXmlDynamicEvent[],
): number => {
  const primaryStaff = track.staves[0];
  if (!primaryStaff) {
    return 0;
  }
  const primaryBeats = beatsByVoice(primaryStaff)[0] ?? [];
  const timedBeats = timedTrackBeats(track);
  const timedEvents = timedSourceDynamicEvents(track, sourceEvents);
  const partWide = partWidePlaybackStaff(track, sourceEvents) !== null;
  const groups = new Map<string, TimedBeat[]>();
  for (const timed of timedBeats) {
    const voice = timed.beat.voice;
    const key = `${voice.bar.staff.index}:${voice.index}`;
    const group = groups.get(key) ?? [];
    group.push(timed);
    groups.set(key, group);
  }
  let adjustedNotes = 0;

  for (const [index, beat] of primaryBeats.entries()) {
    const direction = gradualWordDirection(beat.text ?? "");
    if (direction === null) {
      continue;
    }

    const start = beat.voice.bar.masterBar.start + beat.playbackStart;
    const startDynamic =
      beat.dynamics === HIDDEN_DYNAMIC
        ? (firstSoundingBeat(primaryBeats, index)?.notes[0]?.dynamics ??
          DEFAULT_UNMARKED_DYNAMIC)
        : beat.dynamics;
    const startRank = dynamicRank(startDynamic);
    const targetBeat = primaryBeats
      .slice(index + 1)
      .find(
        (candidate) =>
          candidate.notes.length > 0 &&
          candidate.dynamics !== HIDDEN_DYNAMIC &&
          dynamicRank(candidate.dynamics) !== startRank,
      );
    const nextInstruction = primaryBeats
      .slice(index + 1)
      .find((candidate) => gradualWordDirection(candidate.text ?? "") !== null);
    const nextHairpin = primaryBeats
      .slice(index + 1)
      .find(
        (candidate) =>
          candidate.crescendo !== alphaTab.model.CrescendoType.None,
      );
    // A source declaration is a boundary even when its value equals the
    // current dynamic. Carried beat.dynamics cannot identify that declaration.
    // Resolve each lane independently so a scoped reset does not stop another
    // staff/voice's inference. Retain the existing piano part-wide policy.
    if (sourceEvents.length > 0) {
      const boundaries = [nextInstruction, nextHairpin].flatMap((candidate) =>
        candidate
          ? [candidate.voice.bar.masterBar.start + candidate.playbackStart]
          : [],
      );
      for (const lane of groups.values()) {
        const laneBeat = lane[0].beat;
        const first = timedEvents.find(
          (event) =>
            event.absoluteStart > start &&
            sourceDynamicMatches(event, laneBeat, partWide),
        );
        const reset = first
          ? effectiveSourceDynamic(
              timedEvents,
              laneBeat,
              first.absoluteStart,
              partWide,
              true,
            )
          : null;
        const otherBoundary = boundaries.length
          ? Math.min(...boundaries)
          : Infinity;
        const hasExplicitTarget =
          reset !== null &&
          reset.absoluteStart <= otherBoundary &&
          (dynamicRank(reset.dynamic) - startRank) * direction > 0;
        const targetRank = hasExplicitTarget
          ? dynamicRank(reset.dynamic)
          : Math.max(
              0,
              Math.min(dynamicLadder.length - 1, startRank + direction),
            );
        const lastBeat = primaryBeats.at(-1) ?? beat;
        const end = Math.min(
          reset?.absoluteStart ?? Infinity,
          otherBoundary,
          lastBeat.voice.bar.masterBar.start +
            lastBeat.playbackStart +
            lastBeat.playbackDuration,
        );
        adjustedNotes += applyRampToTimedBeats({
          beats: lane,
          onsetBeats: timedBeats,
          end,
          hasExplicitTarget,
          start,
          startRank,
          targetRank,
        });
      }
      continue;
    }

    const explicitTarget =
      targetBeat &&
      (!nextInstruction ||
        targetBeat.voice.bar.masterBar.start + targetBeat.playbackStart <=
          nextInstruction.voice.bar.masterBar.start +
            nextInstruction.playbackStart) &&
      (!nextHairpin ||
        targetBeat.voice.bar.masterBar.start + targetBeat.playbackStart <=
          nextHairpin.voice.bar.masterBar.start + nextHairpin.playbackStart) &&
      (dynamicRank(targetBeat.dynamics) - startRank) * direction > 0
        ? targetBeat
        : null;
    const hasExplicitTarget = explicitTarget !== null;
    const targetRank = hasExplicitTarget
      ? dynamicRank(explicitTarget.dynamics)
      : Math.max(0, Math.min(dynamicLadder.length - 1, startRank + direction));
    const fallbackBoundaries = [nextInstruction, nextHairpin].filter(
      (candidate): candidate is alphaTab.model.Beat => candidate !== undefined,
    );
    const nextBoundary = fallbackBoundaries.sort(
      (left, right) =>
        left.voice.bar.masterBar.start +
        left.playbackStart -
        (right.voice.bar.masterBar.start + right.playbackStart),
    )[0];
    const endBeat =
      explicitTarget ?? nextBoundary ?? primaryBeats.at(-1) ?? beat;
    const end =
      hasExplicitTarget || nextBoundary
        ? endBeat.voice.bar.masterBar.start + endBeat.playbackStart
        : endBeat.voice.bar.masterBar.start +
          endBeat.playbackStart +
          endBeat.playbackDuration;

    adjustedNotes += applyRampToTimedBeats({
      beats: timedBeats,
      end,
      hasExplicitTarget,
      start,
      startRank,
      targetRank,
    });
  }

  return adjustedNotes;
};

export interface PlaybackDynamicsResult {
  hairpinAdjustedNotes: number;
  sourceTimedNotes: number;
  textAdjustedNotes: number;
  unmarkedTracks: number[];
}

const restoreSourceWedgeSpans = (
  track: alphaTab.model.Track,
  events: MusicXmlWedgeEvent[],
): void => {
  if (events.length === 0) return;
  // alphaTab's imported voice indices cannot reliably resolve arbitrary MusicXML
  // voice tokens. Preserve its native markers rather than silently erasing a lane.
  if (events.some((event) => event.voice !== null &&
    (!Number.isSafeInteger(Number(event.voice)) || Number(event.voice) < 1))) return;
  const compare = (
    a: { measureIndex: number; quarter: number },
    b: { measureIndex: number; quarter: number },
  ): number => a.measureIndex - b.measureIndex || a.quarter - b.quarter;
  const sorted = [...events].sort(compare);
  const active = new Map<string, MusicXmlWedgeEvent>();
  const spans: {
    start: MusicXmlWedgeEvent;
    stop: MusicXmlWedgeEvent | null;
  }[] = [];
  for (const event of sorted) {
    if (event.type === "continue") continue;
    // A wedge number identifies its document-order span; staff/voice on the
    // stop are optional placement, not a different identity. Keep the start's
    // scope. Concurrent reuse is ambiguous: retain every native marker rather
    // than clearing lanes and inventing an unbounded span.
    const previous = active.get(event.number);
    if (previous && event.type !== "stop") return;
    if (previous) spans.push({ start: previous, stop: event });
    active.delete(event.number);
    if (event.type !== "stop") active.set(event.number, event);
  }
  for (const start of active.values()) spans.push({ start, stop: null });
  for (const staff of track.staves)
    for (const bar of staff.bars)
      for (const voice of bar.voices)
        for (const beat of voice.beats) {
          // Do not insert a note/rest or move a source stop to the next beat. Only
          // attacks inside the original half-open span receive its gradual marker.
          beat.crescendo = alphaTab.model.CrescendoType.None;
          const point = {
            measureIndex: bar.index,
            quarter: beat.playbackStart / 960,
          };
          for (const span of spans) {
            if (
              span.start.staff !== null &&
              span.start.staff !== staff.index + 1
            )
              continue;
            if (
              span.start.voice !== null &&
              Number(span.start.voice) !== voice.index + 1
            )
              continue;
            if (
              compare(point, span.start) >= 0 &&
              (span.stop === null || compare(point, span.stop) < 0)
            )
              beat.crescendo =
                span.start.type === "crescendo"
                  ? alphaTab.model.CrescendoType.Crescendo
                  : alphaTab.model.CrescendoType.Decrescendo;
          }
        }
};

/**
 * alphaTab 1.8 imports hairpins visually but does not use them for MIDI, and
 * its MusicXML importer keeps one global dynamic state across parts, staves,
 * and voices. Rebuild explicit dynamics from source-timed lane metadata, apply
 * gradual marks only to note velocities, and suppress invented glyphs on
 * completely unmarked tracks while giving those notes a neutral rehearsal
 * velocity.
 */
export const applyAlphaTabPlaybackDynamics = (
  score: alphaTab.model.Score,
  partsWithExplicitDynamics: boolean[],
  playbackTrackCount = score.tracks.length,
  dynamicEventsByPart: MusicXmlDynamicEvent[][] = [],
  wedgeEventsByPart: MusicXmlWedgeEvent[][] = [],
  dynamicGlyphsCompleteByPart: boolean[] = [],
): PlaybackDynamicsResult => {
  const unmarkedTracks: number[] = [];

  for (const [trackIndex, track] of score.tracks.entries()) {
    if (partsWithExplicitDynamics[trackIndex] !== false) {
      continue;
    }
    unmarkedTracks.push(trackIndex);
    for (const staff of track.staves) {
      for (const bar of staff.bars) {
        for (const voice of bar.voices) {
          for (const beat of voice.beats) {
            beat.dynamics = HIDDEN_DYNAMIC;
            setNoteDynamics(beat, DEFAULT_UNMARKED_DYNAMIC);
          }
        }
      }
    }
  }

  let sourceTimedNotes = 0;
  for (const [trackIndex, track] of score.tracks.entries()) {
    const events = dynamicEventsByPart[trackIndex] ?? [];
    if (partsWithExplicitDynamics[trackIndex] !== false && events.length > 0) {
      sourceTimedNotes += applySourceDynamicEvents(track, events);
    }
  }

  for (const [index, track] of score.tracks.entries()) {
    restoreSourceWedgeSpans(track, wedgeEventsByPart[index] ?? []);
  }
  let hairpinAdjustedNotes = 0;
  let textAdjustedNotes = 0;
  for (const [trackIndex, track] of score.tracks
    .slice(0, playbackTrackCount)
    .entries()) {
    const sourceStaffIndex = partWidePlaybackStaff(
      track,
      dynamicEventsByPart[trackIndex] ?? [],
    );
    if (sourceStaffIndex !== null) {
      hairpinAdjustedNotes += applyPartWideHairpins(track, sourceStaffIndex);
    } else {
      for (const staff of track.staves) {
        for (const voiceBeats of beatsByVoice(staff)) {
          hairpinAdjustedNotes += applyHairpinsToVoice(voiceBeats);
        }
      }
    }
    textAdjustedNotes += applyGradualWordsToTrack(
      track,
      dynamicEventsByPart[trackIndex] ?? [],
    );
    restoreSourceDynamicOnsets(track, dynamicEventsByPart[trackIndex] ?? []);
  }
  for (const [trackIndex, track] of score.tracks.entries()) {
    if (dynamicGlyphsCompleteByPart[trackIndex] === true)
      restoreSourceDynamicGlyphs(track, dynamicEventsByPart[trackIndex] ?? []);
  }

  return {
    hairpinAdjustedNotes,
    sourceTimedNotes,
    textAdjustedNotes,
    unmarkedTracks,
  };
};
