const naturalPitches = [0, 2, 4, 5, 7, 9, 11];
const sharpOrder = [3, 0, 4, 1, 5, 2, 6];
const flatOrder = [6, 2, 5, 1, 4, 0, 3];

export type StaffPitchAnchor = { y: number; stepSize: number; step: number; writtenMidi: number; signature: number };

function writtenPitch(step: number, signature: number) {
  const octave = Math.floor(step / 7), degree = step - octave * 7;
  const order = signature < 0 ? flatOrder : sharpOrder;
  const accidental = order.indexOf(degree) < Math.abs(signature) ? Math.sign(signature) : 0;
  return 12 * (octave + 1) + naturalPitches[degree] + accidental;
}

export function pitchClass(midi: number) {
  return (midi % 12 + 12) % 12;
}

export function keyPitchClasses(signature: number) {
  return new Set(naturalPitches.map((_, step) => pitchClass(writtenPitch(step, signature))));
}

// A fitted pitch sits at its actual notehead, including written accidentals.
// Between adjacent diatonic positions the distance scales with that interval.
export function staffPitchY(anchor: StaffPitchAnchor, error: number) {
  const direction = Math.sign(error);
  let distance = Math.abs(error), pitch = anchor.writtenMidi, offset = 0;
  while (distance > 0) {
    const next = writtenPitch(anchor.step + direction * (offset + 1), anchor.signature);
    const interval = Math.max(1, direction * (next - pitch));
    if (distance <= interval) return anchor.y - direction * anchor.stepSize * (offset + distance / interval);
    distance -= interval;
    pitch += direction * interval;
    offset++;
  }
  return anchor.y;
}
