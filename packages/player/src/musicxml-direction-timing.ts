import { collectMusicXmlTimeVisibility } from './musicxml-time-visibility-source.ts';
import type { MusicXmlTimeVisibility } from './musicxml-time-visibility-source.ts';
import { collectMusicXmlTempoMeasures } from './musicxml-metronome.ts';
import type { MusicXmlTempoMeasure } from './musicxml-metronome.ts';
import { collectMusicXmlCreatorCredits } from './musicxml-creator-credits.ts';
import type { MusicXmlCreatorCredits } from './musicxml-creator-credits.ts';
import { XMLBuilder, XMLParser } from "fast-xml-parser";
export { CURRENT_IMPORT_INPUT_VERSION, isCompatibleMusicXmlPreparation } from './preparation-format.ts';

type OrderedNode = Record<string, unknown>;

interface TimedChild {
  cursor: number;
  index: number;
  isChord: boolean;
  node: OrderedNode;
  staff: string | null;
  tag: string;
  voice: string | null;
}

interface MovedDirection {
  index: number;
  node: OrderedNode;
  staff: string | null;
  target: number;
  voice: string | null;
}

export interface PreparedMusicXml {
  bytes: Uint8Array;
  /** Absent preserves the original direction-only preparation contract. */
  importInputVersion?: string;
  /** First-part printed numbers. Empty is distinct from legacy missing metadata. */
  measureLabels?: string[];
  tempoMeasures?: MusicXmlTempoMeasure[];
  creatorCredits?: MusicXmlCreatorCredits;
  timeVisibility?: MusicXmlTimeVisibility;
  dynamicEventsByPart: MusicXmlDynamicEvent[][];
  dynamicGlyphsCompleteByPart?: boolean[];
  wedgeEventsByPart?: MusicXmlWedgeEvent[][];
  wordEventsByPart?: (MusicXmlWordEvent[] | null)[];
  partsWithExplicitDynamics: boolean[];
  partsWithVoiceScopedDynamics: boolean[];
}

export interface MusicXmlDynamicEvent {
  /** Explicit direction placement; absent retains native below-staff behavior. */
  placement?: "above" | "below";
  measureIndex: number;
  quarter: number;
  staff: number | null;
  value: string;
  voice: string | null;
}

export interface MusicXmlWordEvent {
  measureIndex: number; quarter: number; staff: number | null; text: string;
  placement?: "above" | "below"; fontSize?: number; fontFamilies?: string[]; italic?: boolean; bold?: boolean;
}

export interface MusicXmlWedgeEvent {
  placement?: "above" | "below";
  measureIndex: number;
  quarter: number;
  staff: number | null;
  voice: string | null;
  number: string;
  type: "crescendo" | "diminuendo" | "stop" | "continue";
}

const parser = new XMLParser({
  attributeNamePrefix: "@_",
  ignoreAttributes: false,
  parseAttributeValue: false,
  parseTagValue: false,
  preserveOrder: true,
  trimValues: true,
});

const builder = new XMLBuilder({
  attributeNamePrefix: "@_",
  format: false,
  ignoreAttributes: false,
  preserveOrder: true,
  suppressEmptyNode: true,
});

const tagName = (node: OrderedNode): string =>
  Object.keys(node).find((key) => key !== ":@") ?? "";

const childNodes = (node: OrderedNode, tag: string): OrderedNode[] => {
  const value = node[tag];
  return Array.isArray(value) ? (value as OrderedNode[]) : [];
};

const directText = (children: OrderedNode[], tag: string): string | null => {
  const child = children.find((candidate) => tagName(candidate) === tag);
  if (!child) {
    return null;
  }
  const textNode = childNodes(child, tag).find((candidate) => "#text" in candidate);
  const value = textNode?.["#text"];
  return typeof value === "string" ? value : value == null ? null : String(value);
};

const directNumber = (children: OrderedNode[], tag: string): number => {
  const value = Number(directText(children, tag) ?? 0);
  return Number.isFinite(value) ? value : 0;
};

const hasDirectChild = (children: OrderedNode[], tag: string): boolean =>
  children.some((child) => tagName(child) === tag);

const hasDescendantTag = (nodes: OrderedNode[], tag: string): boolean =>
  nodes.some((node) => {
    const name = tagName(node);
    return name === tag || hasDescendantTag(childNodes(node, name), tag);
  });

const hasVoiceScopedDynamics = (nodes: OrderedNode[]): boolean =>
  nodes.some((node) => {
    const name = tagName(node);
    const children = childNodes(node, name);
    if (
      name === "direction" &&
      hasDescendantTag(children, "dynamics") &&
      directText(children, "voice") !== null
    ) {
      return true;
    }
    return hasVoiceScopedDynamics(children);
  });

const findDescendant = (
  nodes: OrderedNode[],
  tag: string,
): OrderedNode | null => {
  for (const node of nodes) {
    const name = tagName(node);
    if (name === tag) {
      return node;
    }
    const nested = findDescendant(childNodes(node, name), tag);
    if (nested) {
      return nested;
    }
  }
  return null;
};

const collectDynamicEvents = (partChildren: OrderedNode[]): MusicXmlDynamicEvent[] => {
  const events: MusicXmlDynamicEvent[] = [];
  let divisions = 1;
  const measures = partChildren.filter((node) => tagName(node) === "measure");

  for (const [measureIndex, measureNode] of measures.entries()) {
    let cursor = 0;
    for (const node of childNodes(measureNode, "measure")) {
      const tag = tagName(node);
      const children = childNodes(node, tag);
      if (tag === "attributes") {
        const declaredDivisions = directNumber(children, "divisions");
        if (declaredDivisions > 0) {
          divisions = declaredDivisions;
        }
        continue;
      }
      if (tag === "direction") {
        const dynamicsNode = findDescendant(children, "dynamics");
        if (dynamicsNode) {
          const dynamicTag = childNodes(dynamicsNode, "dynamics")
            .map(tagName)
            .find((name) => name !== "#text");
          if (dynamicTag) {
            const staffText = directText(children, "staff");
            const staff = staffText === null ? null : Number(staffText);
            const placement = (node[":@"] as Record<string, unknown> | undefined)?.["@_placement"];
            events.push({
              ...(placement === "above" || placement === "below" ? { placement } : {}),
              measureIndex,
              quarter: (cursor + directNumber(children, "offset")) / divisions,
              staff: staff !== null && Number.isFinite(staff) ? staff : null,
              value: dynamicTag,
              voice: directText(children, "voice"),
            });
          }
        }
        continue;
      }
      if (tag === "note") {
        if (!hasDirectChild(children, "chord") && !hasDirectChild(children, "grace")) {
          cursor += directNumber(children, "duration");
        }
      } else if (tag === "backup") {
        cursor -= directNumber(children, "duration");
      } else if (tag === "forward") {
        cursor += directNumber(children, "duration");
      }
    }
  }
  return events;
};

const findDescendants = (nodes: OrderedNode[], tag: string): OrderedNode[] =>
  nodes.flatMap((node) => {
    const name = tagName(node);
    return name === tag ? [node] : findDescendants(childNodes(node, name), tag);
  });

// Read before direction reordering: alphaTab ignores an offbeat wedge offset.
const collectWedgeEvents = (
  partChildren: OrderedNode[],
): MusicXmlWedgeEvent[] => {
  const events: MusicXmlWedgeEvent[] = [];
  let divisions = 1;
  const measures = partChildren.filter((node) => tagName(node) === "measure");
  for (const [measureIndex, measure] of measures.entries()) {
    let cursor = 0;
    for (const node of childNodes(measure, "measure")) {
      const tag = tagName(node),
        children = childNodes(node, tag);
      if (tag === "attributes") {
        const declared = directNumber(children, "divisions");
        if (declared > 0) divisions = declared;
      } else if (tag === "direction") {
        for (const wedge of findDescendants(children, "wedge")) {
          const attributes = wedge[":@"] as Record<string, string> | undefined;
          const type = attributes?.["@_type"];
          if (
            type === "crescendo" ||
            type === "diminuendo" ||
            type === "stop" ||
            type === "continue"
          ) {
            const staffText = directText(children, "staff");
            const staff = staffText === null ? null : Number(staffText);
            events.push({
              measureIndex,
              quarter: (cursor + directNumber(children, "offset")) / divisions,
              staff: staff !== null && Number.isFinite(staff) ? staff : null,
              voice: directText(children, "voice"),
              number: attributes?.["@_number"] ?? "1",
              ...((node[":@"] as Record<string,string> | undefined)?.["@_placement"] === "above" || (node[":@"] as Record<string,string> | undefined)?.["@_placement"] === "below" ? {placement:(node[":@"] as Record<string,string> | undefined)?.["@_placement"] as "above" | "below"}:{}),
              type,
            });
          }
        }
      } else if (tag === "note") {
        if (
          !hasDirectChild(children, "chord") &&
          !hasDirectChild(children, "grace")
        )
          cursor += directNumber(children, "duration");
      } else if (tag === "backup") cursor -= directNumber(children, "duration");
      else if (tag === "forward") cursor += directNumber(children, "duration");
    }
  }
  return events;
};

// The playback collector intentionally accepts a bounded first dynamic symbol.
// Glyph cleanup must not erase source signs that collector could not represent.
const hasCompleteDynamicGlyphEvents = (partChildren: OrderedNode[]): boolean => {
  for (const direction of findDescendants(partChildren, "direction")) {
    const marks = findDescendants(childNodes(direction, "direction"), "dynamics");
    if (marks.length > 1) return false;
    for (const mark of marks) {
      // Some producers use this hidden-glyph hint although MusicXML 4 dynamics
      // does not define print-object. Do not turn that hint into a visible mark.
      if ((mark[":@"] as Record<string, unknown> | undefined)?.["@_print-object"] === "no") return false;
      const symbols = childNodes(mark, "dynamics").filter(node => tagName(node) !== "#text");
      if (symbols.length !== 1 || tagName(symbols[0]) === "other-dynamics") return false;
    }
  }
  return true;
};

const needsBeatAlignedOffset = (directionChildren: OrderedNode[]): boolean =>
  ["dynamics", "wedge", "words"].some((tag) =>
    hasDescendantTag(directionChildren, tag),
  );

const nearlyEqual = (left: number, right: number): boolean =>
  Math.abs(left - right) < 0.000_001;

const matchesDirectionLane = (event: TimedChild, direction: MovedDirection): boolean => {
  if (event.tag !== "note") {
    return true;
  }
  if (direction.staff !== null && event.staff !== direction.staff) {
    return false;
  }
  return direction.voice === null || event.voice === direction.voice;
};

const chooseAnchor = (
  events: TimedChild[],
  direction: MovedDirection,
): OrderedNode | null => {
  const exact = events.filter(
    (event) =>
      nearlyEqual(event.cursor, direction.target) && matchesDirectionLane(event, direction),
  );
  const exactNote = exact.find((event) => event.tag === "note" && !event.isChord);
  if (exactNote) {
    return exactNote.node;
  }
  if (exact.length > 0) {
    return exact[0].node;
  }
  return null;
};

const normalizeMeasure = (children: OrderedNode[]): OrderedNode[] => {
  let cursor = 0;
  let measureEnd = 0;
  const timedChildren: TimedChild[] = [];
  const movedDirections: MovedDirection[] = [];

  for (const [index, node] of children.entries()) {
    const tag = tagName(node);
    if (tag === "direction") {
      const directionChildren = childNodes(node, tag);
      const offsetIndex = directionChildren.findIndex(
        (child) => tagName(child) === "offset",
      );
      if (offsetIndex >= 0 && needsBeatAlignedOffset(directionChildren)) {
        const offset = directNumber(directionChildren, "offset");
        if (!nearlyEqual(offset, 0)) {
          movedDirections.push({
            index,
            node,
            staff: directText(directionChildren, "staff"),
            target: cursor + offset,
            voice: directText(directionChildren, "voice"),
          });
          continue;
        }
      }
    }

    if (tag === "note" || tag === "backup" || tag === "forward") {
      const timedNodeChildren = childNodes(node, tag);
      timedChildren.push({
        cursor,
        index,
        isChord: tag === "note" && hasDirectChild(timedNodeChildren, "chord"),
        node,
        staff: tag === "note" ? (directText(timedNodeChildren, "staff") ?? "1") : null,
        tag,
        voice: tag === "note" ? (directText(timedNodeChildren, "voice") ?? "1") : null,
      });

      if (tag === "note") {
        if (
          !hasDirectChild(timedNodeChildren, "chord") &&
          !hasDirectChild(timedNodeChildren, "grace")
        ) {
          cursor += directNumber(timedNodeChildren, "duration");
          measureEnd = Math.max(measureEnd, cursor);
        }
      } else if (tag === "backup") {
        cursor -= directNumber(timedNodeChildren, "duration");
      } else {
        cursor += directNumber(timedNodeChildren, "duration");
        measureEnd = Math.max(measureEnd, cursor);
      }
    }
  }

  if (movedDirections.length === 0) {
    return children;
  }

  const movedNodes = new Set<OrderedNode>();
  const before = new Map<OrderedNode, OrderedNode[]>();
  const tail: OrderedNode[] = [];

  for (const direction of movedDirections) {
    const anchor = chooseAnchor(timedChildren, direction);
    if (anchor) {
      const directionChildren = childNodes(direction.node, "direction");
      const offsetIndex = directionChildren.findIndex(
        (child) => tagName(child) === "offset",
      );
      if (offsetIndex >= 0) {
        directionChildren.splice(offsetIndex, 1);
      }
      movedNodes.add(direction.node);
      const pending = before.get(anchor) ?? [];
      pending.push(direction.node);
      before.set(anchor, pending);
    } else if (nearlyEqual(direction.target, measureEnd)) {
      const directionChildren = childNodes(direction.node, "direction");
      const offsetIndex = directionChildren.findIndex(
        (child) => tagName(child) === "offset",
      );
      if (offsetIndex >= 0) {
        directionChildren.splice(offsetIndex, 1);
      }
      movedNodes.add(direction.node);
      tail.push(direction.node);
    }
  }

  const remaining = children.filter((child) => !movedNodes.has(child));

  const normalized: OrderedNode[] = [];
  for (const child of remaining) {
    normalized.push(...(before.get(child) ?? []), child);
  }

  if (tail.length > 0) {
    const barlineIndex = normalized.findIndex((child) => tagName(child) === "barline");
    if (barlineIndex >= 0) {
      normalized.splice(barlineIndex, 0, ...tail);
    } else {
      normalized.push(...tail);
    }
  }
  return normalized;
};

const normalizeForwardsForAlphaTab = (children: OrderedNode[]): OrderedNode[] => {
  const staffsByVoice = new Map<string, Set<string>>();
  for (const node of children) {
    if (tagName(node) !== "note") {
      continue;
    }
    const noteChildren = childNodes(node, "note");
    const voice = directText(noteChildren, "voice") ?? "1";
    const staff = directText(noteChildren, "staff") ?? "1";
    const staffs = staffsByVoice.get(voice) ?? new Set<string>();
    staffs.add(staff);
    staffsByVoice.set(voice, staffs);
  }

  return children.map((node) => {
    if (tagName(node) !== "forward") {
      return node;
    }
    const forwardChildren = childNodes(node, "forward");
    const durationNode = forwardChildren.find((child) => tagName(child) === "duration");
    if (!durationNode) {
      return node;
    }
    const voiceNode = forwardChildren.find((child) => tagName(child) === "voice");
    const staffNode = forwardChildren.find((child) => tagName(child) === "staff");
    const voice = directText(forwardChildren, "voice") ?? "1";
    const inferredStaffs = staffsByVoice.get(voice);
    const inferredStaff = inferredStaffs?.size === 1 ? [...inferredStaffs][0] : null;
    const resolvedStaffNode = staffNode ?? (inferredStaff ? { staff: [{ "#text": inferredStaff }] } : null);

    return {
      note: [
        { rest: [] },
        durationNode,
        ...(voiceNode ? [voiceNode] : []),
        ...(resolvedStaffNode ? [resolvedStaffNode] : []),
      ],
      ":@": {
        "@_print-object": "no",
        "@_print-spacing": "no",
      },
    };
  });
};

/**
 * alphaTab 1.8 reads MusicXML direction offsets for tempo and pedals, but not
 * for dynamics, words, or wedges. Reordering only those unsupported visual
 * directions that land on an exact note/rest onset (or the measure end)
 * creates an equivalent in-memory document whose directions occur at the
 * intended musical cursor, so notation and note velocities attach to the right
 * beat without changing the source MusicXML. Offsets inside a sustained note
 * are preserved instead of being moved to a wrong later note. Tempo- and
 * pedal-only offsets are left untouched because alphaTab handles them on a
 * separate path.
 */
export const normalizeMusicXmlDirectionTiming = (xml: string): string => {
  const document = parser.parse(xml) as OrderedNode[];
  for (const rootNode of document) {
    const scoreChildren = childNodes(rootNode, "score-partwise");
    if (scoreChildren.length === 0) {
      continue;
    }
    for (const partNode of scoreChildren.filter((node) => tagName(node) === "part")) {
      for (const measureNode of childNodes(partNode, "part").filter(
        (node) => tagName(node) === "measure",
      )) {
        measureNode.measure = normalizeMeasure(childNodes(measureNode, "measure"));
      }
    }
  }
  return builder.build(document);
};

const genericFontFamilies = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui']);
/** A narrow generic CSS family list; named/custom fonts still need an explicit support contract. */
const readGenericFontFamilies = (value: string): string[] | null => {
    const families = value.split(',').map(family => family.trim().toLowerCase());
    return families.length > 0 && families.every(family => genericFontFamilies.has(family)) ? families : null;
};

const collectSourceWordEvents = (partChildren: OrderedNode[]): MusicXmlWordEvent[] | null => {
    const events: MusicXmlWordEvent[] = []; let divisions = 1;
    for (const [measureIndex, measure] of partChildren.filter(n => tagName(n) === 'measure').entries()) {
        let cursor = 0;
        for (const node of childNodes(measure, 'measure')) {
            const tag = tagName(node), children = childNodes(node,tag);
            if (tag === 'attributes') { const d = directNumber(children,'divisions'); if (d>0) divisions=d; }
            else if (tag === 'direction') {
                for (const words of findDescendants(children,'words')) {
                    const content = childNodes(words,'words');
                    if (content.some(c => tagName(c) !== '#text')) return null;
                    const text = content.map(c => c['#text'] ?? '').join('');
                    const a = (words[':@'] ?? {}) as Record<string,string>;
                    if (a['@_font-size'] !== undefined && (!Number.isFinite(Number(a['@_font-size'])) || Number(a['@_font-size']) <= 0)) return null;
                    if (a['@_rotation'] || a['@_enclosure']) return null;
                    const fontFamilies = a['@_font-family'] === undefined ? undefined : readGenericFontFamilies(a['@_font-family']);
                    if (fontFamilies === null) return null;
                    if (!text.length) continue;
                    const placement = (node[':@'] as Record<string,string> | undefined)?.['@_placement'] as 'above' | 'below' | undefined;
                    if (placement !== undefined && !['above','below'].includes(placement)) return null;
                    const staffText = directText(children,'staff'), staff=staffText===null?null:Number(staffText);
                    if (staff !== null && (!Number.isSafeInteger(staff) || staff<1)) return null;
                    events.push({measureIndex,quarter:(cursor+directNumber(children,'offset'))/divisions,staff,text,
                        ...(placement?{placement}:{}),
                        ...(a['@_font-size']?{fontSize:Number(a['@_font-size'])}:{}),
                        ...(fontFamilies?{fontFamilies}:{}),
                        ...(a['@_font-style']?{italic:a['@_font-style']==='italic'}:{}),
                        ...(a['@_font-weight']?{bold:a['@_font-weight']==='bold'}:{})});
                }
            } else if (tag === 'note' && !hasDirectChild(children,'chord') && !hasDirectChild(children,'grace')) cursor+=directNumber(children,'duration');
            else if (tag === 'backup') cursor-=directNumber(children,'duration');
            else if (tag === 'forward') cursor+=directNumber(children,'duration');
        }
    }
    return events;
};

export const prepareMusicXmlForAlphaTabBytes = (bytes: Uint8Array): PreparedMusicXml => {
  const xml = new TextDecoder().decode(bytes);
  const document = parser.parse(xml) as OrderedNode[];
  const tempoMeasures = collectMusicXmlTempoMeasures(document);
  const dynamicEventsByPart: MusicXmlDynamicEvent[][] = [];
  const dynamicGlyphsCompleteByPart: boolean[] = [];
  const wedgeEventsByPart: MusicXmlWedgeEvent[][] = [];
  const wordEventsByPart: (MusicXmlWordEvent[] | null)[] = [];
  const partsWithExplicitDynamics: boolean[] = [];
  const partsWithVoiceScopedDynamics: boolean[] = [];
  const firstPart = document.flatMap(node => childNodes(node, 'score-partwise')).find(node => tagName(node) === 'part');
  const measureLabels = childNodes(firstPart ?? {}, 'part').filter(node => tagName(node) === 'measure').map((node, index) => {
    const attributes = node[':@'] as Record<string, string> | undefined;
    return attributes?.['@_number']?.trim() || String(index + 1);
  });

  for (const rootNode of document) {
    const scoreChildren = childNodes(rootNode, "score-partwise");
    if (scoreChildren.length === 0) {
      continue;
    }
    for (const partNode of scoreChildren.filter((node) => tagName(node) === "part")) {
      const partChildren = childNodes(partNode, "part");
      dynamicEventsByPart.push(collectDynamicEvents(partChildren));
      dynamicGlyphsCompleteByPart.push(hasCompleteDynamicGlyphEvents(partChildren));
      wedgeEventsByPart.push(collectWedgeEvents(partChildren));
      wordEventsByPart.push(collectSourceWordEvents(partChildren));
      partsWithExplicitDynamics.push(hasDescendantTag(partChildren, "dynamics"));
      partsWithVoiceScopedDynamics.push(hasVoiceScopedDynamics(partChildren));
      for (const measureNode of partChildren.filter(
        (node) => tagName(node) === "measure",
      )) {
        measureNode.measure = normalizeForwardsForAlphaTab(
          normalizeMeasure(childNodes(measureNode, "measure")),
        );
      }
    }
  }

  return {
    bytes: new TextEncoder().encode(builder.build(document)),
    measureLabels,
    tempoMeasures,
    creatorCredits: collectMusicXmlCreatorCredits(document),
    timeVisibility: collectMusicXmlTimeVisibility(document),
    dynamicEventsByPart,
    dynamicGlyphsCompleteByPart,
    wedgeEventsByPart,
    wordEventsByPart,
    partsWithExplicitDynamics,
    partsWithVoiceScopedDynamics,
  };
};

export const normalizeMusicXmlDirectionTimingBytes = (bytes: Uint8Array): Uint8Array => {
  return prepareMusicXmlForAlphaTabBytes(bytes).bytes;
};
