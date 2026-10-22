import { XMLBuilder, XMLParser } from 'fast-xml-parser';

type Node = Record<string, unknown>;
type Endpoint = { marker: Node; notation: Node; ordinal: number; onset: number; end: number; key: string; type: string; number: string };
type Pair = { start: Endpoint; stop: Endpoint; id?: string };
const options = { ignoreAttributes: false, preserveOrder: true, parseTagValue: false, parseAttributeValue: false };
const parser = new XMLParser(options);
const builder = new XMLBuilder({ ...options, suppressEmptyNode: true });
const tag = (node: Node) => Object.keys(node).find(key => key !== ':@') ?? '';
const children = (node: Node, name: string): Node[] => Array.isArray(node[name]) ? node[name] as Node[] : [];
const attributes = (node: Node): Record<string, string> => (node[':@'] ?? {}) as Record<string, string>;
const text = (nodes: Node[], name: string): string => {
  const element = nodes.find(node => tag(node) === name);
  return element ? children(element, name).map(node => node['#text'] ?? '').join('') : '';
};
const adjacent = (a: number, b: number) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-7;

/** Assign importer-safe IDs only to complete, adjacent, unambiguous written-pitch
 * ties. alphaTab's numbered lookup is staff scoped and follows XML order, which
 * may differ from musical time across voices. Numbered stops leave a stale
 * origin in alphaTab's pitch-only fallback set, so later ordinary unnumbered
 * chains need the same repair as transposed chains. The original attachment
 * bytes are never changed.
 * Historical function name retained as an internal compatibility seam. */
export function normalizeMusicXmlTransposedTies(bytes: Uint8Array): Uint8Array {
  const source = new TextDecoder().decode(bytes);
  if (!/<tied(?:\s|>)/.test(source)) return bytes;
  const tree = parser.parse(source) as Node[];
  const root = tree.find(node => tag(node) === 'score-partwise');
  if (!root) return bytes;
  let changed = false;
  for (const part of children(root, 'score-partwise').filter(node => tag(node) === 'part')) {
    const contents = children(part, 'part');
    const endpoints: Endpoint[] = [];
    let unsupportedTimeline = false;
    let divisions = 1, measureStart = 0, meter = 0, ordinal = 0, measureIndex = 0;
    for (const measure of contents.filter(node => tag(node) === 'measure')) {
      let cursor = 0, extent = 0, previousOnset = 0;
      for (const node of children(measure, 'measure')) {
        const kind = tag(node);
        const content = children(node, kind);
        if (kind === 'attributes') {
          const value = Number(text(content, 'divisions'));
          if (Number.isFinite(value) && value > 0) divisions = value;
          const times = content.filter(item => tag(item) === 'time');
          if (times.length > 1 || times.some(time => attributes(time)['@_number'])) unsupportedTimeline = true;
          const time = times[0];
          if (time) {
            const ts = children(time, 'time');
            if (ts.filter(item => tag(item) === 'beats').length > 1 || ts.filter(item => tag(item) === 'beat-type').length > 1) unsupportedTimeline = true;
            const beats = text(ts, 'beats').split('+').map(Number);
            const denominator = Number(text(ts, 'beat-type'));
            meter = beats.every(value => Number.isFinite(value) && value > 0) && denominator > 0
              ? beats.reduce((sum, value) => sum + value, 0) * 4 / denominator : 0;
          }
          continue;
        }
        if (kind === 'backup' || kind === 'forward') {
          const length = Number(text(content, 'duration')) / divisions;
          cursor += kind === 'backup' ? -length : length;
          extent = Math.max(extent, cursor);
          continue;
        }
        if (kind !== 'note') continue;
        const notations = content.filter(item => tag(item) === 'notations');
        if (content.some(item => tag(item) === 'grace')) {
          // Grace timing is not part of this finite-duration pairing model.
          // Its tied endpoint must still block the part: skipping it would let
          // native fallback consume an origin numbered by this repair.
          if (notations.some(notation => children(notation, 'notations').some(item => tag(item) === 'tied'))) unsupportedTimeline = true;
          continue;
        }
        const duration = Number(text(content, 'duration')) / divisions;
        const chord = content.some(item => tag(item) === 'chord');
        const onset = chord ? previousOnset : cursor;
        if (!chord) { previousOnset = onset; cursor += duration; }
        extent = Math.max(extent, onset + duration, cursor);
        const pitch = content.find(item => tag(item) === 'pitch');
        ordinal++;
        if (!pitch) continue;
        const p = children(pitch, 'pitch');
        const identity = [text(content, 'staff') || '1', text(content, 'voice') || '1', text(p, 'step'), Number(text(p, 'alter') || '0'), text(p, 'octave')];
        for (const notation of notations) {
          for (const marker of children(notation, 'notations').filter(item => tag(item) === 'tied')) {
            const number = attributes(marker)['@_number'] || '';
            endpoints.push({ marker, notation, ordinal, onset: measureStart + onset,
              end: duration > 0 ? measureStart + onset + duration : NaN,
              key: [...identity, number].join(':'), type: attributes(marker)['@_type'], number });
          }
        }
      }
      // Respect silent remainder of ordinary bars. The opening pickup and bars
      // explicitly marked implicit retain their actual duration.
      measureStart += measureIndex++ === 0 || attributes(measure)['@_implicit'] === 'yes' ? extent : Math.max(extent, meter);
    }
    if (unsupportedTimeline) continue; // unmodelled timelines must remain entirely native
    const unsupportedKeys = new Set(endpoints.filter(endpoint => !['start', 'stop'].includes(endpoint.type)).map(endpoint => endpoint.key));
    const groups = new Map<string, Endpoint[]>();
    for (const endpoint of endpoints) {
      if (unsupportedKeys.has(endpoint.key)) continue;
      const group = groups.get(endpoint.key) ?? [];
      group.push(endpoint); groups.set(endpoint.key, group);
    }
    const pairs: Pair[] = [];
    for (const group of groups.values()) {
      const counts = new Map<string, number>();
      for (const endpoint of group) {
        const key = `${endpoint.onset}:${endpoint.type}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      if ([...counts.values()].some(count => count > 1)) continue;
      let active: Endpoint | undefined;
      let ambiguous = false;
      group.sort((a, b) => a.onset - b.onset || (a.type === 'stop' ? 0 : 1) - (b.type === 'stop' ? 0 : 1) || a.ordinal - b.ordinal);
      for (const endpoint of group) {
        if (endpoint.type === 'stop') {
          if (!ambiguous && active && adjacent(active.end, endpoint.onset) && Number.isFinite(endpoint.end) && active.ordinal < endpoint.ordinal)
            pairs.push({ start: active, stop: endpoint });
          active = undefined; ambiguous = false;
        } else if (active || ambiguous) {
          active = undefined; ambiguous = true;
        } else active = endpoint;
      }
    }
    const handled = new Set(pairs.flatMap(pair => [pair.start.marker, pair.stop.marker]));
    // Numbering a safe chain can expose its stale native origin to a later
    // unresolved unnumbered stop. If any unnumbered endpoint cannot be paired
    // safely, preserve the whole part's native path instead of inventing links.
    if (endpoints.some(endpoint => !endpoint.number && !handled.has(endpoint.marker))) continue;
    // Unsafe or unsupported endpoints retain their original IDs. Never allocate
    // one of those IDs to a repaired chain anywhere in this part.
    const reserved = new Set(endpoints.filter(endpoint => !handled.has(endpoint.marker)).map(endpoint => endpoint.number).filter(Boolean));
    const allocated: Pair[] = [];
    let failed = false;
    for (const pair of pairs.sort((a, b) => a.start.ordinal - b.start.ordinal)) {
      const occupied = new Set([...reserved, ...allocated.filter(other => other.stop.ordinal > pair.start.ordinal).map(other => other.id!)]);
      pair.id = Array.from({ length: 16 }, (_, index) => String(index + 1)).find(id => !occupied.has(id));
      if (!pair.id) { failed = true; break; }
      allocated.push(pair);
    }
    if (failed) continue; // no partial rewrites if the MusicXML ID budget is exhausted
    const changedNotations = new Set<Node>();
    for (const pair of allocated) {
      for (const endpoint of [pair.start, pair.stop]) {
        if (endpoint.number !== pair.id) { endpoint.marker[':@'] = { ...attributes(endpoint.marker), '@_number': pair.id! }; changed = true; }
        changedNotations.add(endpoint.notation);
      }
    }
    for (const notation of changedNotations) {
      const content = children(notation, 'notations');
      const indices = content.map((node, index) => tag(node) === 'tied' ? index : -1).filter(index => index >= 0);
      const markers = indices.map(index => content[index]).sort((a, b) =>
        (attributes(a)['@_type'] === 'stop' ? 0 : 1) - (attributes(b)['@_type'] === 'stop' ? 0 : 1));
      if (indices.some((index, markerIndex) => content[index] !== markers[markerIndex])) changed = true;
      indices.forEach((index, markerIndex) => { content[index] = markers[markerIndex]; });
    }
  }
  return changed ? new TextEncoder().encode(builder.build(tree)) : bytes;
}
