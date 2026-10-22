export const DEFAULT_OTHER_PART_VOLUME = 0.25;

export interface PracticePartIdentityInput {
  displayName: string;
  normalizedPart: string | null;
  trackIndex: number;
}

export interface PracticePartIdentity extends PracticePartIdentityInput {
  selectionKey: string;
}

const clampUnit = (value: number): number => Math.min(1, Math.max(0, value));

export const normalizePracticePart = (name: string): string | null => {
  const normalized = name.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (/soprano/.test(normalized)) {
    return "soprano";
  }
  if (/contralto|alto/.test(normalized)) {
    return "alto";
  }
  if (/tenor/.test(normalized)) {
    return "tenor";
  }
  if (/bass/.test(normalized)) {
    return "bass";
  }
  if (/piano|harp|accompaniment/.test(normalized)) {
    return "accompaniment";
  }
  return normalized.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || null;
};

const countBy = <T>(items: T[], keyForItem: (item: T) => string | null): Map<string, number> => {
  const counts = new Map<string, number>();
  items.forEach((item) => {
    const key = keyForItem(item);
    if (key) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  });
  return counts;
};

export const buildPracticePartIdentities = (
  inputs: PracticePartIdentityInput[],
  scoreId: string,
): PracticePartIdentity[] => {
  const normalizedCounts = countBy(inputs, (input) => input.normalizedPart);
  const displayCounts = countBy(inputs, (input) => input.displayName.trim().toLowerCase());
  const displayOccurrences = new Map<string, number>();

  return inputs.map((input) => {
    const displayKey = input.displayName.trim().toLowerCase();
    const displayOccurrence = (displayOccurrences.get(displayKey) ?? 0) + 1;
    displayOccurrences.set(displayKey, displayOccurrence);
    const duplicateDisplayName = (displayCounts.get(displayKey) ?? 0) > 1;
    const duplicateNormalizedPart =
      input.normalizedPart !== null && (normalizedCounts.get(input.normalizedPart) ?? 0) > 1;

    return {
      ...input,
      displayName: duplicateDisplayName
        ? `${input.displayName} ${displayOccurrence}`
        : input.displayName,
      selectionKey:
        input.normalizedPart && !duplicateNormalizedPart
          ? input.normalizedPart
          : `score:${encodeURIComponent(scoreId)}:track:${input.trackIndex}`,
    };
  });
};

export const findPracticeTrackIndex = (
  identities: PracticePartIdentity[],
  selectionKey: string | null,
): number | null => {
  if (!selectionKey) {
    return null;
  }
  return identities.find((identity) => identity.selectionKey === selectionKey)?.trackIndex ?? null;
};

interface EffectiveTrackVolumeOptions {
  baseVolumes: number[];
  mixGain: number;
  practiceTrackIndex: number | null;
  otherPartVolume: number;
}

export const calculateEffectiveTrackVolumes = ({
  baseVolumes,
  mixGain,
  practiceTrackIndex,
  otherPartVolume,
}: EffectiveTrackVolumeOptions): number[] => {
  const safeMixGain = Math.max(0, mixGain);
  if (
    practiceTrackIndex === null ||
    practiceTrackIndex < 0 ||
    practiceTrackIndex >= baseVolumes.length
  ) {
    return baseVolumes.map((volume) => clampUnit(volume) * safeMixGain);
  }

  const supportVolume = clampUnit(otherPartVolume);
  const leadVolume = clampUnit(baseVolumes[practiceTrackIndex] ?? 0);

  return baseVolumes.map((_, index) =>
    (index === practiceTrackIndex ? leadVolume : supportVolume) * safeMixGain,
  );
};
