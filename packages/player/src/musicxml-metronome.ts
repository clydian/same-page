import { XMLParser } from 'fast-xml-parser';

type Node = Record<string, unknown>;
export interface MusicXmlTempoEvent { quarter: number; bpm: number; visible: boolean }
export interface MusicXmlTempoMeasure { events: MusicXmlTempoEvent[]; complete: boolean }
const tag = (node: Node) => Object.keys(node).find(key => key !== ':@') ?? '';
const children = (node: Node, name: string): Node[] => Array.isArray(node[name]) ? node[name] as Node[] : [];
const text = (node: Node, name: string) => children(node, name).map(child => child['#text'] ?? '').join('').trim();
const attributes = (node: Node): Record<string, string> => (node[':@'] ?? {}) as Record<string, string>;
const quarters: Readonly<Record<string, number>> = {
  maxima: 32, long: 16, breve: 8, whole: 4, half: 2, quarter: 1,
  eighth: .5, '16th': .25, '32nd': .125, '64th': .0625,
  '128th': .03125, '256th': .015625, '512th': .0078125, '1024th': .00390625,
};
function positiveNumber(value: string | undefined): number | null {
  if (value === undefined || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}
type TempoValue = { kind: 'absolute'; bpm: number } | { kind: 'relative'; factor: number };
function metronomeValue(mark: Node): TempoValue | null {
  const items = children(mark, 'metronome');
  let cursor = 0;
  const unit = (): number | null => {
    const first = items[cursor];
    if (!first || tag(first) !== 'beat-unit') return null;
    const length = quarters[text(first, 'beat-unit')];
    if (!length) return null;
    cursor++;
    let dots = 0;
    while (items[cursor] && tag(items[cursor]) === 'beat-unit-dot') { dots++; cursor++; }
    return length * (2 - 2 ** -dots);
  };
  const before = unit();
  if (before === null) return null;
  if (items[cursor] && tag(items[cursor]) === 'per-minute') {
    const rate = positiveNumber(text(items[cursor++], 'per-minute'));
    return cursor === items.length && rate !== null && Number.isFinite(rate * before)
      ? { kind: 'absolute', bpm: rate * before } : null;
  }
  const after = unit();
  return after !== null && cursor === items.length
    ? { kind: 'relative', factor: after / before } : null;
}
type TempoInstruction = TempoValue & { quarter: number; visible: boolean; priority: number };

/** Collect before importer normalization. Resolve simple beat-unit equalities
 * in score-time order, once per global onset rather than once per part copy.
 * Unsupported tied units, tuplets/ranges and pass-specific marks keep native
 * fallback; their unknown carried tempo cannot seed a later relative mark. */
export function collectMusicXmlTempoMeasures(document: Node[]): MusicXmlTempoMeasure[] {
  const measures: MusicXmlTempoMeasure[] = [];
  const instructions: TempoInstruction[][] = [];
  for (const root of document) for (const part of children(root, 'score-partwise').filter(node => tag(node) === 'part')) {
    let divisions = 1;
    const partMeasures = children(part, 'part').filter(node => tag(node) === 'measure');
    partMeasures.forEach((measure, index) => {
      const target = measures[index] ??= { events: [], complete: true };
      const pending = instructions[index] ??= [];
      let cursor = 0;
      const add = (quarter: number, value: TempoValue, visible: boolean, priority: number) => {
        if (!Number.isFinite(quarter) || quarter < 0) target.complete = false;
        else pending.push({ ...value, quarter, visible, priority });
      };
      for (const node of children(measure, 'measure')) {
        const name = tag(node), items = children(node, name);
        const find = (key: string) => items.find(child => tag(child) === key);
        if (name === 'attributes') {
          const value = find('divisions');
          if (value) { const parsed = positiveNumber(text(value, 'divisions')); if (parsed !== null) divisions = parsed; else target.complete = false; }
        } else if (['note', 'backup', 'forward'].includes(name)) {
          if (name === 'note' && (find('chord') || find('grace'))) continue;
          const duration = find('duration');
          const value = duration ? Number(text(duration, 'duration')) / divisions : 0;
          cursor += name === 'backup' ? -value : value;
        } else if (name === 'direction' || name === 'sound') {
          const offset = find('offset');
          const directionQuarter = cursor + (offset && attributes(offset)['@_sound'] !== 'no' ? Number(text(offset, 'offset')) / divisions : 0);
          const marks = name === 'direction' ? items.filter(child => tag(child) === 'direction-type').flatMap(type => children(type, 'direction-type').filter(child => tag(child) === 'metronome')) : [];
          const sound = name === 'sound' ? node : find('sound');
          if (sound && attributes(sound)['@_time-only'] !== undefined) target.complete = false;
          const soundValue = sound ? attributes(sound)['@_tempo'] : undefined;
          const soundBpm = positiveNumber(soundValue);
          if (soundValue !== undefined && soundBpm === null) target.complete = false;
          const soundOffset = sound ? children(sound, 'sound').find(child => tag(child) === 'offset') : undefined;
          const soundQuarter = soundOffset ? cursor + Number(text(soundOffset, 'offset')) / divisions : directionQuarter;
          for (const mark of marks) {
            const value = metronomeValue(mark);
            if (value === null) { target.complete = false; continue; }
            // The original XML retains the printed equality. Its inferred numeric
            // quarter BPM is playback metadata, never a fabricated printed number.
            add(directionQuarter, value, value.kind === 'absolute' && attributes(mark)['@_print-object'] !== 'no', 1);
          }
          if (soundBpm !== null) add(soundQuarter, { kind: 'absolute', bpm: soundBpm }, false, 2);
        }
      }
    });
  }
  let carriedBpm: number | null = 120; // existing player default, not source print
  measures.forEach((measure, index) => {
    if (!measure.complete) { carriedBpm = null; return; }
    const groups = new Map<number, TempoInstruction[]>();
    for (const event of instructions[index] ?? []) {
      const group = groups.get(event.quarter) ?? [];
      group.push(event); groups.set(event.quarter, group);
    }
    for (const [quarter, group] of [...groups].sort(([left], [right]) => left - right)) {
      const absolute = group.filter((event): event is TempoInstruction & { kind: 'absolute' } => event.kind === 'absolute');
      const winningPriority = Math.max(...absolute.map(event => event.priority));
      const winner = absolute.filter(event => event.priority === winningPriority).at(-1);
      let bpm: number | null;
      if (winner) bpm = winner.bpm;
      else {
        const ratios = new Set(group.filter((event): event is TempoInstruction & { kind: 'relative' } => event.kind === 'relative').map(event => event.factor));
        bpm = ratios.size === 1 && carriedBpm !== null ? carriedBpm * [...ratios][0] : null;
      }
      if (bpm === null || !Number.isFinite(bpm) || bpm <= 0) {
        measure.complete = false; carriedBpm = null; break;
      }
      carriedBpm = bpm;
      // Playback may follow an explicit sound value which differs from every
      // printed absolute mark. Do not print that winning playback number as if
      // it came from the source. Rendering the original mark independently is
      // outside this numeric automation model, so its absence stays explicit.
      const visible = group.some(event => event.visible && event.kind === 'absolute' && event.bpm === bpm);
      measure.events.push({ quarter, bpm, visible });
    }
  });
  return measures;
}

/** Compatibility fallback for callers supplying older prepared payloads. */
export function readMusicXmlTempoMeasures(bytes: Uint8Array): MusicXmlTempoMeasure[] {
  const parser = new XMLParser({ ignoreAttributes: false, preserveOrder: true, parseTagValue: false, parseAttributeValue: false });
  return collectMusicXmlTempoMeasures(parser.parse(new TextDecoder().decode(bytes)) as Node[]);
}
