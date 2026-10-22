import { XMLParser } from "fast-xml-parser";

type OrderedNode = Record<string, unknown>;

export type MajorMusicXmlIssueSeverity = "error" | "warning";

export interface MajorMusicXmlIssue {
  code:
    | "measure-duration"
    | "negative-cursor"
    | "rest-duration"
    | "voice-overlap";
  location: string;
  message: string;
  severity: MajorMusicXmlIssueSeverity;
}

const parser = new XMLParser({
  attributeNamePrefix: "@_",
  ignoreAttributes: false,
  parseAttributeValue: false,
  parseTagValue: false,
  preserveOrder: true,
});

const asOrderedArray = (value: unknown): OrderedNode[] =>
  Array.isArray(value) ? value.filter((entry): entry is OrderedNode => typeof entry === "object" && entry !== null) : [];

const tagName = (node: OrderedNode): string =>
  Object.keys(node).find((key) => key !== ":@") ?? "";

const nodeAttr = (node: OrderedNode, name: string): string | null => {
  const attributes = node[":@"];
  if (typeof attributes !== "object" || attributes === null || Array.isArray(attributes)) return null;
  const value = (attributes as OrderedNode)[`@_${name}`];
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
};

const childNodes = (node: OrderedNode, tag: string): OrderedNode[] =>
  asOrderedArray(node[tag]);

const directText = (children: OrderedNode[], tag: string): string | null => {
  const child = children.find((candidate) => tagName(candidate) === tag);
  if (!child) return null;
  const candidate = childNodes(child, tag).find((entry) => Object.hasOwn(entry, "#text"));
  if (!candidate) return null;
  const text = candidate["#text"];
  return typeof text === "string" ? text.trim() : text == null ? null : String(text).trim();
};

const directNumber = (children: OrderedNode[], tag: string): number | null => {
  const raw = directText(children, tag);
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
};

const hasDirectChild = (children: OrderedNode[], tag: string): boolean =>
  children.some((child) => tagName(child) === tag);

const noteDotCount = (children: OrderedNode[]): number =>
  children.filter((child) => tagName(child) === "dot").length;

const parseTuplet = (children: OrderedNode[]): boolean => hasDirectChild(children, "time-modification");

const nearlyEqual = (left: number, right: number): boolean => Math.abs(left - right) < 0.000_001;

const NOTE_BASE_QUARTERS: Record<string, number> = {
  whole: 4,
  half: 2,
  quarter: 1,
  eighth: 0.5,
  "16th": 0.25,
  "32nd": 0.125,
  "64th": 0.0625,
  "128th": 0.03125,
};

const quarterUnitsForType = (type: string): number | null => {
  const normalized = type.trim().toLowerCase();
  return NOTE_BASE_QUARTERS[normalized] ?? null;
};

const dottedLengthMultiplier = (dots: number): number => {
  let factor = 1;
  let increment = 0.5;
  for (let index = 0; index < dots; index += 1) {
    factor += increment;
    increment /= 2;
  }
  return factor;
};

const expectedRestLength = (type: string, dots: number, divisions: number): number | null => {
  const quarterLength = quarterUnitsForType(type);
  if (quarterLength === null || !Number.isFinite(divisions) || divisions <= 0) return null;
  const expected = quarterLength * divisions * dottedLengthMultiplier(dots);
  return Number.isFinite(expected) ? expected : null;
};

const measureSignatureUnits = (divisions: number, beats: number, beatType: number): number | null => {
  if (!Number.isFinite(divisions) || !Number.isFinite(beats) || !Number.isFinite(beatType)) return null;
  if (divisions <= 0 || beats <= 0 || beatType <= 0) return null;
  const units = (4 * divisions * beats) / beatType;
  return Number.isFinite(units) ? units : null;
};

const safeIssueLocation = (partId: string, measureNumber: string, lane: string): string =>
  `part ${partId} · 小节 ${measureNumber}${lane ? ` · ${lane}` : ""}`;

const safeMeasureNumber = (measureIndex: number, wrapper: OrderedNode): string =>
  nodeAttr(wrapper, "number") || String(measureIndex + 1);

export const validateMajorMusicXmlIssues = (bytes: Uint8Array): MajorMusicXmlIssue[] => {
  const xml = new TextDecoder().decode(bytes);
  const document = parser.parse(xml) as OrderedNode[];
  const issues: MajorMusicXmlIssue[] = [];

  for (const root of document) {
    const scoreChildren = childNodes(root, "score-partwise");
    if (scoreChildren.length === 0) {
      continue;
    }

    for (const partWrapper of scoreChildren.filter((node) => tagName(node) === "part")) {
      const partId = nodeAttr(partWrapper, "id") || "unknown-part";
      const measureWrappers = childNodes(partWrapper, "part").filter((node) => tagName(node) === "measure");
      let divisions = 4;
      let beats: number | null = 4;
      let beatType: number | null = 4;

      for (let measureIndex = 0; measureIndex < measureWrappers.length; measureIndex += 1) {
        const measureWrapper = measureWrappers[measureIndex];
        const measureNumber = safeMeasureNumber(measureIndex, measureWrapper);
        const isImplicitMeasure = nodeAttr(measureWrapper, "implicit") === "yes";
        const measureChildren = childNodes(measureWrapper, "measure");

        if (measureChildren.length === 0) {
          continue;
        }

        let activeCursor = 0;
        const laneCursor = new Map<string, number>();
        const laneEvents = new Map<string, Array<{ on: number; off: number }>>();

        const maxCursor = (): number => {
          const allCursorValues = [...laneCursor.values(), activeCursor];
          return allCursorValues.reduce((max, value) => Math.max(max, value), 0);
        };

        for (const node of measureChildren) {
          const tag = tagName(node);
          const children = childNodes(node, tag);

          if (tag === "attributes") {
            const nextDivisions = directNumber(children, "divisions");
            if (nextDivisions !== null && nextDivisions > 0) {
              divisions = nextDivisions;
            }
            const time = children.filter((child) => tagName(child) === "time");
            const latestTime = time.at(-1);
            if (latestTime) {
              const timeChildren = childNodes(latestTime, "time");
              const nextBeats = directNumber(timeChildren, "beats");
              const nextBeatType = directNumber(timeChildren, "beat-type");
              if (nextBeats !== null && nextBeatType !== null) {
                beats = nextBeats;
                beatType = nextBeatType;
              }
            }
            continue;
          }

          if (tag === "backup" || tag === "forward") {
            const offset = directNumber(children, "duration");
            if (offset === null) {
              continue;
            }
            if (tag === "backup") {
              activeCursor -= offset;
              if (activeCursor < 0) {
                issues.push({
                  code: "negative-cursor",
                  severity: "error",
                  location: `${partId} · 小节 ${measureNumber}`,
                  message: `backup 偏移 ${offset} 导致时间游标小于 0`,
                });
              }
            } else {
              activeCursor += offset;
            }
            continue;
          }

          if (tag !== "note") {
            continue;
          }

          const isGrace = hasDirectChild(children, "grace");
          if (isGrace) {
            continue;
          }

          const isChord = hasDirectChild(children, "chord");
          const isRest = hasDirectChild(children, "rest");
          const duration = directNumber(children, "duration");

          if (duration === null) {
            if (isRest) {
              issues.push({
                code: "measure-duration",
                severity: "error",
                location: safeIssueLocation(partId, measureNumber, `voice ${directText(children, "voice") || "1"} staff ${directText(children, "staff") || "1"}`),
                message: "休止符缺少 duration 标记",
              });
            }
            continue;
          }

          if (duration < 0) {
            issues.push({
              code: "measure-duration",
              severity: "error",
              location: safeIssueLocation(partId, measureNumber, `voice ${directText(children, "voice") || "1"} staff ${directText(children, "staff") || "1"}`),
              message: `duration 为负数 (${duration})`,
            });
            continue;
          }

          if (isChord) {
            continue;
          }

          const staff = directText(children, "staff") || "1";
          const voice = directText(children, "voice") || "1";
          const laneKey = `staff ${staff} voice ${voice}`;
          const on = activeCursor;
          const off = on + duration;
          const events = laneEvents.get(laneKey) ?? [];
          const overlap = events.find((event) => !(event.off <= on || off <= event.on));
          if (overlap) {
            issues.push({
              code: "voice-overlap",
              severity: "error",
              location: safeIssueLocation(partId, measureNumber, laneKey),
              message: `同一声部/谱表出现重叠： [${on}, ${off}] 与 [${overlap.on}, ${overlap.off}]`,
            });
          } else {
            events.push({ on, off });
            laneEvents.set(laneKey, events);
          }

          laneCursor.set(laneKey, Math.max(laneCursor.get(laneKey) ?? 0, off));
          activeCursor = Math.max(activeCursor, off);

          if (isRest && !parseTuplet(children)) {
            const type = directText(children, "type") ?? "";
            if (quarterUnitsForType(type) !== null) {
              const dots = noteDotCount(children);
              const expectedDuration = expectedRestLength(type, dots, divisions);
              if (expectedDuration !== null && !nearlyEqual(duration, expectedDuration)) {
                issues.push({
                  code: "rest-duration",
                  severity: "error",
                  location: safeIssueLocation(partId, measureNumber, laneKey),
                  message: `休止符长度不一致：duration=${duration}，type=${type}（含${dots}个附点）应为 ${expectedDuration}`,
                });
              }
            }
          }
        }

        const currentBeats = beats;
        const currentBeatType = beatType;
        if (!isImplicitMeasure && currentBeats !== null && currentBeatType !== null) {
          const expectedUnits = measureSignatureUnits(divisions, currentBeats, currentBeatType);
          if (expectedUnits !== null) {
            const measuredUnits = maxCursor();
            const delta = measuredUnits - expectedUnits;
            if (!nearlyEqual(delta, 0)) {
              const severity: MajorMusicXmlIssue["severity"] =
                Math.abs(delta) >= divisions ? "error" : "warning";
              issues.push({
                code: "measure-duration",
                severity,
                location: safeIssueLocation(partId, measureNumber, ""),
                message: `小节时值不齐：实际 ${measuredUnits}，应为 ${expectedUnits}（偏差 ${delta > 0 ? "+" : ""}${delta}）`,
              });
            }
          }
        }
      }
    }
  }

  return issues;
};
