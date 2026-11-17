import { XMLParser } from 'fast-xml-parser';

type Node = Record<string, unknown>;
const tag = (node: Node) => Object.keys(node).find(key => key !== ':@') ?? '';
const children = (node: Node, name: string): Node[] => Array.isArray(node[name]) ? node[name] as Node[] : [];
const text = (nodes: Node[], name: string) => children(nodes.find(node => tag(node) === name) ?? {}, name).map(node => node['#text'] ?? '').join('').trim();

/** A candidate must end at the same source position in every part and voice.
 * Explicit rests and forward gaps count; missing/unknown lanes never imply silence. */
export function collectMusicXmlMeasureDurations(document: Node[]): (number | null)[] {
  const parts = document.flatMap(root => children(root, 'score-partwise')).filter(node => tag(node) === 'part');
  const durations = parts.map(part => {
    let divisions = 1;
    return children(part, 'part').filter(node => tag(node) === 'measure').map(measure => {
      let cursor = 0, extent = 0, previousOnset = 0, valid = true;
      const ends = new Map<string, number>();
      for (const node of children(measure, 'measure')) {
        const name = tag(node), items = children(node, name);
        if (name === 'attributes') {
          const value = text(items, 'divisions');
          if (value) { divisions = Number(value); valid &&= Number.isFinite(divisions) && divisions > 0; }
        } else if (['note', 'forward', 'backup'].includes(name)) {
          if (items.some(item => tag(item) === 'grace')) continue;
          const value = text(items, 'duration');
          const duration = Number(value) / divisions;
          if (!value || !Number.isFinite(duration) || duration <= 0) { valid = false; continue; }
          if (name === 'backup') cursor -= duration;
          else if (name === 'forward') cursor += duration;
          else {
            const chord = items.some(item => tag(item) === 'chord');
            const onset = chord ? previousOnset : cursor;
            const key = `${text(items, 'staff') || '1'}:${text(items, 'voice') || '1'}`;
            ends.set(key, Math.max(ends.get(key) ?? 0, onset + duration));
            extent = Math.max(extent, onset + duration);
            if (!chord) { previousOnset = onset; cursor += duration; }
          }
          if (cursor < -1e-8) valid = false;
          extent = Math.max(extent, cursor);
        }
      }
      return valid && ends.size > 0 && [...ends.values()].every(end => Math.abs(end - extent) < 1e-8) ? extent : null;
    });
  });
  return Array.from({ length: Math.max(0, ...durations.map(part => part.length)) }, (_, index) => {
    const value = durations[0]?.[index];
    return value != null && durations.every(part => part[index] != null && Math.abs(part[index]! - value) < 1e-8) ? value : null;
  });
}

export function readMusicXmlMeasureDurations(bytes: Uint8Array): (number | null)[] {
  return collectMusicXmlMeasureDurations(new XMLParser({ ignoreAttributes: false, preserveOrder: true }).parse(new TextDecoder().decode(bytes)) as Node[]);
}
