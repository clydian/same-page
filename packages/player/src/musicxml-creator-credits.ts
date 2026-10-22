import { XMLParser } from 'fast-xml-parser';

type Node = Record<string, unknown>;
export interface MusicXmlCreatorCredits { composers: string[]; arrangers: string[] }
const tag = (node: Node) => Object.keys(node).find(key => key !== ':@') ?? '';
const children = (node: Node, name: string): Node[] => Array.isArray(node[name]) ? node[name] as Node[] : [];

/** Source roles stay separate from alphaTab's generic artist/music fields.
 * This collector is safe in the preparation Worker and changes no XML. */
export function collectMusicXmlCreatorCredits(document: Node[]): MusicXmlCreatorCredits {
  const credits: MusicXmlCreatorCredits = { composers: [], arrangers: [] };
  for (const root of document) for (const node of children(root, 'score-partwise')) {
    if (tag(node) !== 'identification') continue;
    for (const creator of children(node, 'identification')) {
      if (tag(creator) !== 'creator') continue;
      const role = (creator[':@'] as Record<string, string> | undefined)?.['@_type'];
      const name = children(creator, 'creator').map(child => String(child['#text'] ?? '')).join('').replace(/\s+/gu, ' ').trim();
      if (!name) continue;
      if (role === 'composer') credits.composers.push(name);
      else if (role === 'arranger') credits.arrangers.push(name);
    }
  }
  return credits;
}

/** Older prepared payloads did not carry creator metadata. */
export function readMusicXmlCreatorCredits(bytes: Uint8Array): MusicXmlCreatorCredits {
  const parser = new XMLParser({ ignoreAttributes: false, preserveOrder: true, parseTagValue: false, parseAttributeValue: false });
  return collectMusicXmlCreatorCredits(parser.parse(new TextDecoder().decode(bytes)) as Node[]);
}
