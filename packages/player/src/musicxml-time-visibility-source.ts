import { XMLParser } from 'fast-xml-parser';

type Node = Record<string, unknown>;
export interface MusicXmlTimeVisibility {
  /** alphaTab 1.8.4 creates one track per score-part, in part-list order. */
  partIds: string[];
  parts: { trackIndex: number; measures: { index: number; all: boolean | null; staves: [number, boolean][] }[] }[];
}
const rawTag = (node: Node) => Object.keys(node).find(key => key !== ':@') ?? '';
const tag = (node: Node) => rawTag(node).split(':').at(-1) ?? '';
const children = (node: Node): Node[] => {
  const value = node[rawTag(node)];
  return Array.isArray(value) ? value as Node[] : [];
};
const attrs = (node: Node) => (node[':@'] ?? {}) as Record<string, string>;

/** Read engraving intent without changing MusicXML or musical time. Unsupported
 * timewise/ambiguous part mappings are deliberately left to the native importer. */
export function readMusicXmlTimeVisibility(bytes: Uint8Array): MusicXmlTimeVisibility {
  const parser = new XMLParser({ ignoreAttributes: false, preserveOrder: true, removeNSPrefix: true, parseTagValue: false, parseAttributeValue: false });
  const document = parser.parse(new TextDecoder().decode(bytes)) as Node[];
  return collectMusicXmlTimeVisibility(document);
}

export function collectMusicXmlTimeVisibility(document: Node[]): MusicXmlTimeVisibility {
  const root = document.find(node => tag(node) === 'score-partwise');
  const result: MusicXmlTimeVisibility = { partIds: [], parts: [] };
  if (!root) return result;
  const nodes = children(root);
  const lists = nodes.filter(node => tag(node) === 'part-list');
  if (lists.length !== 1) return result;
  result.partIds = children(lists[0]).filter(node => tag(node) === 'score-part').map(node => attrs(node)['@_id']);
  if (result.partIds.some(id => !id) || new Set(result.partIds).size !== result.partIds.length) return { partIds: [], parts: [] };
  const parts = nodes.filter(node => tag(node) === 'part');
  for (const part of parts) {
    const id = attrs(part)['@_id'];
    const trackIndex = result.partIds.indexOf(id);
    if (trackIndex < 0 || parts.filter(other => attrs(other)['@_id'] === id).length !== 1) continue;
    const measures: MusicXmlTimeVisibility['parts'][number]['measures'] = [];
    children(part).filter(node => tag(node) === 'measure').forEach((measure, index) => {
      const times = children(measure).filter(node => tag(node) === 'attributes').flatMap(children).filter(node => tag(node) === 'time');
      let all: boolean | null = null;
      const staves = new Map<number, boolean>();
      const seen = new Set<number>();
      let ambiguous = false;
      for (const time of times) {
        const attributes = attrs(time);
        const number = attributes['@_number'];
        const key = number === undefined ? 0 : /^\d+$/.test(number) ? Number(number) : -1;
        if (key < 0 || (number !== undefined && key === 0) || seen.has(key)) { ambiguous = true; break; }
        seen.add(key);
        const visible = attributes['@_print-object'] !== 'no';
        if (key === 0) all = visible;
        else staves.set(key - 1, visible);
      }
      if (!ambiguous && (all === false || [...staves.values()].includes(false))) measures.push({ index, all, staves: [...staves] });
    });
    if (measures.length) result.parts.push({ trackIndex, measures });
  }
  return result;
}
