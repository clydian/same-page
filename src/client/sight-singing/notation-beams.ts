type Stem = { x: number; top: number; bottom: number; status?: string };
type Point = { x: number; y: number };

function beamEnds(path: SVGPathElement) {
  // AlphaTab emits beam segments as flat-sided filled paths directly under
  // the system SVG. Its ties and slurs are curved paths inside beat groups.
  const match = path.getAttribute('d')?.match(/^\s*M(\S+) L(\S+) L(\S+) L(\S+) z$/);
  if (!match) return;
  const [start, end, innerEnd, innerStart] = match.slice(1).map(pair => {
    const [x, y] = pair.split(',').map(Number);
    return { x, y };
  });
  if (start.x !== innerStart.x || end.x !== innerEnd.x || !(start.x < end.x) || start.y === innerStart.y ||
      !Number.isFinite(start.y + end.y + innerStart.y + innerEnd.y) ||
      Math.abs((innerStart.y - start.y) - (innerEnd.y - end.y)) > .00001) return;
  return [start, end] as const;
}

function ink(status?: string) {
  if (!status) return undefined;
  return status === 'wrongNote' || status === 'missed' ? 'wrong' : 'inTune';
}

export function tintBeams(svg: SVGSVGElement, rectangles: SVGRectElement[], scale: number, marked: Set<SVGElement>) {
  const stems: Stem[] = rectangles.map(rect => ({
    x: rect.x.baseVal.value + rect.width.baseVal.value / 2,
    top: rect.y.baseVal.value,
    bottom: rect.y.baseVal.value + rect.height.baseVal.value,
    status: rect.dataset.challengeFeedback,
  }));
  const tolerance = 1.5 * scale; // Native beam and stem coordinates round independently.
  const at = ({ x, y }: Point, tip: boolean) => {
    const matches = stems.filter(stem => Math.abs(x - stem.x) <= tolerance && (tip
      ? Math.min(Math.abs(y - stem.top), Math.abs(y - stem.bottom)) <= tolerance
      : y >= stem.top - tolerance && y <= stem.bottom + tolerance));
    return matches.length === 1 ? matches[0] : undefined;
  };
  const segments = [...svg.querySelectorAll<SVGPathElement>(':scope > path')].flatMap(path => {
    const ends = beamEnds(path);
    return ends ? [{ path, ends }] : [];
  });
  const groups = new Map<Stem, Set<Stem>>();
  const unresolved = new Set<Stem>();
  for (const { ends: [start, end] } of segments) {
    const left = at(start, true), right = at(end, true);
    // A one-ended segment wider than AlphaTab's one-staff-space hook
    // may have an unidentifiable stem. Keep its entire connected group neutral.
    if (end.x - start.x > 10 * scale && Boolean(left) !== Boolean(right)) {
      const known = left ?? right;
      if (known) unresolved.add(known);
    }
    if (!left || !right || left === right) continue;
    const group = groups.get(left) ?? new Set([left]);
    for (const stem of groups.get(right) ?? [right]) group.add(stem);
    for (const stem of group) groups.set(stem, group);
  }
  for (const { path, ends: [start, end] } of segments) {
    const left = at(start, false), right = at(end, false);
    const group = left && groups.get(left);
    const status = left?.status;
    if (!group || !right || groups.get(right) !== group || !status ||
        ![...group].every(stem => !unresolved.has(stem) && ink(stem.status) === ink(status))) continue;
    path.dataset.challengeFeedback = status;
    marked.add(path);
  }
}
