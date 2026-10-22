import type * as alphaTab from "@coderline/alphatab";

export type ToneMode = "choir" | "warm-piano";
export type TimbreRole = "vocal" | "accompaniment" | "other";

export interface ToneProfile {
  label: string;
  program: number;
  bank: number;
  description: string;
}

export const TONE_PROFILES: Record<ToneMode, ToneProfile> = {
  choir: {
    label: "合唱人声",
    program: 52,
    bank: 0,
    description: "合唱声部使用采样的“啊”人声，仅作音高参考，不会演唱歌词；伴奏保持不变。",
  },
  "warm-piano": {
    label: "柔和电钢琴",
    program: 4,
    bank: 0,
    description: "合唱声部使用较柔和的电钢琴；钢琴、竖琴等伴奏保留乐谱原音色。",
  },
};

const ACCOMPANIMENT_PATTERN =
  /accompaniment|keyboard|piano|pianoforte|organ|harp|celesta|guitar|strings?|orchestra/i;
const NON_VOCAL_INSTRUMENT_PATTERN =
  /sax|flute|clarinet|oboe|bassoon|horn|trumpet|trombone|tuba|violin|viola|cello|contrabass|double bass|electric bass|acoustic bass|synth bass|recorder|percussion|drums?/i;
const EXPLICIT_VOCAL_PATTERN =
  /soprano|mezzo|contralto|countertenor|choir|chorus|voice|vocal|singer/i;
const AMBIGUOUS_VOCAL_PATTERN = /(?:^|\W)(?:alto|tenor|baritone|bass|treble)(?:\W|$)/i;
const VOCAL_PROGRAMS = new Set([52, 53, 54]);
const INSTRUMENT_AUTOMATION = 2;

export const classifyTimbreRoles = (
  tracks: alphaTab.model.Track[],
  expectedParts: string[],
): TimbreRole[] => {
  const scoreIdentity = `${expectedParts.join(" ")} ${tracks.map(({ name }) => name ?? "").join(" ")}`;
  const hasChoralContext = EXPLICIT_VOCAL_PATTERN.test(scoreIdentity);
  return tracks.map((track, index) => {
    const identity = `${track.name ?? ""} ${expectedParts[index] ?? ""}`;
    if (ACCOMPANIMENT_PATTERN.test(identity)) return "accompaniment";
    if (NON_VOCAL_INSTRUMENT_PATTERN.test(identity)) return "other";
    if (
      VOCAL_PROGRAMS.has(track.playbackInfo.program) ||
      EXPLICIT_VOCAL_PATTERN.test(identity) ||
      (hasChoralContext && AMBIGUOUS_VOCAL_PATTERN.test(identity))
    ) {
      return "vocal";
    }
    return "other";
  });
};

const rewriteInstrumentAutomations = (
  track: alphaTab.model.Track,
  program: number,
): void => {
  for (const staff of track.staves) {
    for (const bar of staff.bars) {
      for (const voice of bar.voices) {
        for (const beat of voice.beats) {
          for (const automation of beat.automations) {
            if (automation.type === INSTRUMENT_AUTOMATION) {
              automation.value = program;
            }
          }
        }
      }
    }
  }
};

export const applyTimbreProfile = (
  tracks: alphaTab.model.Track[],
  mode: ToneMode,
  roles: TimbreRole[],
): void => {
  const profile = TONE_PROFILES[mode];
  const vocalBalances = [6, 7, 9, 10];
  let vocalIndex = 0;

  tracks.forEach((track, index) => {
    const role = roles[index] ?? "other";
    if (role === "vocal") {
      track.playbackInfo.bank = profile.bank;
      track.playbackInfo.program = profile.program;
      track.playbackInfo.volume = 16;
      track.playbackInfo.balance = vocalBalances[vocalIndex % vocalBalances.length];
      rewriteInstrumentAutomations(track, profile.program);
      vocalIndex += 1;
      return;
    }
    if (role === "accompaniment") {
      track.playbackInfo.volume = 13;
      track.playbackInfo.balance = 8;
    }
  });
};
