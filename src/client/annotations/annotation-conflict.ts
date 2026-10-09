import type { AnnotationPayload } from "../../shared/annotations";
import type { AnnotationConflictRecord } from "../platform/local-database";

export type ConflictStrategy = "discard" | "reapply" | "keep-both";
export type ConflictChoice = { strategy: ConflictStrategy; label: string; consequence: string };

// A review is tied to both variants, never just an operation id. New edits must
// be compared again before an irreversible local discard or a new cloud write.
export function conflictFingerprint(conflict: AnnotationConflictRecord) {
  return JSON.stringify([conflict.opId, conflict.scopeKey, conflict.localDeleted,
    conflict.localPayload, conflict.canonical]);
}

export function conflictChoices(conflict: AnnotationConflictRecord): ConflictChoice[] {
  const cloudDeleted = !conflict.canonical || conflict.canonical.deleted;
  const choices: ConflictChoice[] = [{
    strategy: "discard",
    label: cloudDeleted ? "接受云端删除" : conflict.localDeleted ? "保留云端笔记" : "采用云端版本",
    consequence: cloudDeleted ? "放弃这条本机修改，接受云端删除。" : "放弃这条本机修改，保留云端笔记。",
  }];
  if (!conflict.localDeleted || !cloudDeleted) choices.unshift({
    strategy: "reapply",
    label: conflict.localDeleted ? "仍要删除" : cloudDeleted ? "恢复为本机版本" : "采用本机修改",
    consequence: conflict.localDeleted ? "删除云端这条笔记。" : cloudDeleted ? "将本机笔记重新提交到云端。" : "用本机修改替换云端这条笔记。",
  });
  if (!conflict.localDeleted && conflict.localPayload && !cloudDeleted && conflict.canonical?.payload) choices.push({
    strategy: "keep-both", label: "两份都保留", consequence: "保留云端笔记，另存一条本机笔记；两条笔记可能重叠。",
  });
  return choices;
}

export function conflictPage(conflict: AnnotationConflictRecord, source: "local" | "cloud") {
  const payload = source === "local" ? conflict.localPayload : conflict.canonical?.payload;
  return payload?.pageNumber ?? conflict.localPayload?.pageNumber ?? conflict.canonical?.payload?.pageNumber ?? null;
}

export function annotationBounds(payload: AnnotationPayload) {
  if (payload.kind === "ink") {
    const xs = payload.points.map(point => point.x), ys = payload.points.map(point => point.y);
    return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
  }
  if (payload.kind === "shape") return { left: payload.x, right: payload.x + payload.width, top: payload.y, bottom: payload.y + payload.height };
  const lines = payload.text.split("\n");
  const width = Math.min(1, Math.max(...lines.map(line => [...line].reduce((sum, char) => sum + (char.charCodeAt(0) > 255 ? 1 : .65), 0)), 1) * payload.fontScale);
  const height = payload.fontScale * lines.length * 1.5;
  return { left: payload.x - width / 2, right: payload.x + width / 2, top: payload.y - height / 2, bottom: payload.y + height / 2 };
}

export function conflictRegion(conflict: AnnotationConflictRecord, page: number) {
  const bounds = [conflict.localPayload, conflict.canonical?.payload]
    .filter((payload): payload is AnnotationPayload => Boolean(payload && payload.pageNumber === page)).map(annotationBounds);
  if (!bounds.length) return { x: .5, y: .5 };
  return { x: Math.max(0, Math.min(1, (Math.min(...bounds.map(b => b.left)) + Math.max(...bounds.map(b => b.right))) / 2)),
    y: Math.max(0, Math.min(1, (Math.min(...bounds.map(b => b.top)) + Math.max(...bounds.map(b => b.bottom))) / 2)) };
}
