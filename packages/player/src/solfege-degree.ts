interface Spelling {
  degree: number;
  accidentalOffset: number;
}

const DEGREE_SEMITONES = [0, 2, 4, 5, 7, 9, 11] as const;
const SHARP_KEY_SIGNATURE_ORDER = [3, 0, 4, 1, 5, 2, 6] as const;
const FLAT_KEY_SIGNATURE_ORDER = [6, 2, 5, 1, 4, 0, 3] as const;
const MAJOR_TONIC_DEGREES = [0, 4, 1, 5, 2, 6, 3, 0, 4, 1, 5, 2, 6, 3, 0] as const;

const SHARP_PREFERRED_SPELLINGS: readonly Spelling[] = [
  { degree: 0, accidentalOffset: 0 },
  { degree: 0, accidentalOffset: 1 },
  { degree: 1, accidentalOffset: 0 },
  { degree: 1, accidentalOffset: 1 },
  { degree: 2, accidentalOffset: 0 },
  { degree: 3, accidentalOffset: 0 },
  { degree: 3, accidentalOffset: 1 },
  { degree: 4, accidentalOffset: 0 },
  { degree: 4, accidentalOffset: 1 },
  { degree: 5, accidentalOffset: 0 },
  { degree: 5, accidentalOffset: 1 },
  { degree: 6, accidentalOffset: 0 },
];

const FLAT_PREFERRED_SPELLINGS: readonly Spelling[] = [
  { degree: 0, accidentalOffset: 0 },
  { degree: 1, accidentalOffset: -1 },
  { degree: 1, accidentalOffset: 0 },
  { degree: 2, accidentalOffset: -1 },
  { degree: 2, accidentalOffset: 0 },
  { degree: 3, accidentalOffset: 0 },
  { degree: 4, accidentalOffset: -1 },
  { degree: 4, accidentalOffset: 0 },
  { degree: 5, accidentalOffset: -1 },
  { degree: 5, accidentalOffset: 0 },
  { degree: 6, accidentalOffset: -1 },
  { degree: 6, accidentalOffset: 0 },
];

const SPELLING_CANDIDATES: readonly (readonly Spelling[])[] = Array.from(
  { length: 12 },
  (_, chroma) => {
    const candidates: Spelling[] = [];
    for (let degree = 0; degree < DEGREE_SEMITONES.length; degree += 1) {
      for (let accidentalOffset = -2; accidentalOffset <= 2; accidentalOffset += 1) {
        const candidateChroma =
          ((DEGREE_SEMITONES[degree] + accidentalOffset) % 12 + 12) % 12;
        if (candidateChroma === chroma) {
          candidates.push({ degree, accidentalOffset });
        }
      }
    }
    return candidates;
  },
);

const keySignatureAccidentalOffset = (keySignature: number, degree: number): number => {
  const order = keySignature >= 0 ? SHARP_KEY_SIGNATURE_ORDER : FLAT_KEY_SIGNATURE_ORDER;
  const affectedCount = Math.min(7, Math.abs(keySignature));
  for (let index = 0; index < affectedCount; index += 1) {
    if (order[index] === degree) return keySignature >= 0 ? 1 : -1;
  }
  return 0;
};

const forcedAccidentalOffset = (accidentalMode: number): number | null => {
  switch (accidentalMode) {
    case 1: // ForceNone
    case 2: // ForceNatural
      return 0;
    case 3: // ForceSharp
      return 1;
    case 4: // ForceDoubleSharp
      return 2;
    case 5: // ForceFlat
      return -1;
    case 6: // ForceDoubleFlat
      return -2;
    default:
      return null;
  }
};

const resolveSpelling = (
  noteValue: number,
  keySignature: number,
  accidentalMode: number,
): Spelling => {
  const chroma = ((noteValue % 12) + 12) % 12;
  const candidates = SPELLING_CANDIDATES[chroma];
  const forcedOffset = forcedAccidentalOffset(accidentalMode);
  if (forcedOffset !== null) {
    const forced = candidates.find(({ accidentalOffset }) => accidentalOffset === forcedOffset);
    if (forced) return forced;
  }

  const signatureMatch = candidates.find(
    ({ degree, accidentalOffset }) =>
      keySignatureAccidentalOffset(keySignature, degree) === accidentalOffset,
  );
  if (signatureMatch) return signatureMatch;
  return (keySignature < 0 ? FLAT_PREFERRED_SPELLINGS : SHARP_PREFERRED_SPELLINGS)[chroma];
};

const accidentalPrefix = (offset: number): string => {
  if (offset < 0) return "♭".repeat(Math.min(2, Math.abs(offset)));
  if (offset > 0) return "♯".repeat(Math.min(2, offset));
  return "";
};

/**
 * Returns a movable-do scale degree for alphaTab's written note value.
 * Degree 1 follows the major tonic implied by the current key signature;
 * minor-key scores therefore use the conventional la-based 6 as tonic.
 */
export const solfegeDegreeLabel = (
  noteValue: number,
  keySignature: number,
  accidentalMode: number,
): string => {
  const safeKeySignature = Math.max(-7, Math.min(7, Math.round(keySignature)));
  const spelling = resolveSpelling(noteValue, safeKeySignature, accidentalMode);
  const tonicDegree = MAJOR_TONIC_DEGREES[safeKeySignature + 7];
  const degree = ((spelling.degree - tonicDegree + 7) % 7) + 1;
  const chromaticOffset =
    spelling.accidentalOffset - keySignatureAccidentalOffset(safeKeySignature, spelling.degree);
  return `${accidentalPrefix(chromaticOffset)}${degree}`;
};
