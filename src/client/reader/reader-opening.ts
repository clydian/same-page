import type { ReaderOpeningFacts, ReaderOpeningPhase } from "../../shared/reader-opening";

export interface ReaderOpeningSnapshot {
  phase: ReaderOpeningPhase;
  source: ReaderOpeningFacts["source"];
  loadedBytes: number | null;
  totalBytes: number | null;
  startedAt: number;
  phaseStartedAt: number;
  lastProgressAt: number;
  stoppedAt: number | null;
  durations: ReaderOpeningFacts["durations"];
}

export class ReaderOpening {
  private state: ReaderOpeningSnapshot;
  constructor() {
    const now = performance.now();
    this.state = { phase: "source", source: "unknown", loadedBytes: null, totalBytes: null,
      startedAt: now, phaseStartedAt: now, lastProgressAt: now, stoppedAt: null, durations: {} };
  }
  getSnapshot = () => this.state;
  restorePresented(snapshot: ReaderOpeningSnapshot) { this.state = snapshot; }
  update(phase: ReaderOpeningPhase, progress?: Pick<ReaderOpeningFacts, "loadedBytes" | "totalBytes">, source = this.state.source) {
    const now = performance.now();
    const previous = this.state;
    const changedSource = previous.source !== source;
    const loadedBytes = progress ? progress.loadedBytes : (changedSource ? null : previous.loadedBytes);
    const totalBytes = progress ? progress.totalBytes : (changedSource ? null : previous.totalBytes);
    const changed = previous.phase !== phase;
    if (!changed && !changedSource && previous.loadedBytes === loadedBytes && previous.totalBytes === totalBytes) return;
    this.state = { ...previous, phase, source, loadedBytes, totalBytes, stoppedAt: null,
      phaseStartedAt: changed ? now : previous.phaseStartedAt, lastProgressAt: now,
      durations: changed ? { ...previous.durations, [previous.phase]: (previous.durations[previous.phase] ?? 0) + now - previous.phaseStartedAt } : previous.durations };
  }
  stop() { if (this.state.stoppedAt === null) this.state = { ...this.state, stoppedAt: performance.now() }; }
}

export function readerOpeningFacts(snapshot: ReaderOpeningSnapshot, now = performance.now()): ReaderOpeningFacts {
  const end = snapshot.stoppedAt ?? now;
  const duration = (value: number) => Math.min(86_400_000, Math.max(0, Math.round(value)));
  return { phase: snapshot.phase, source: snapshot.source, loadedBytes: snapshot.loadedBytes, totalBytes: snapshot.totalBytes,
    elapsedMs: duration(end - snapshot.startedAt), phaseElapsedMs: duration(end - snapshot.phaseStartedAt),
    lastProgressAgoMs: duration(end - snapshot.lastProgressAt),
    durations: Object.fromEntries(Object.entries({ ...snapshot.durations, [snapshot.phase]: (snapshot.durations[snapshot.phase] ?? 0) + end - snapshot.phaseStartedAt }).map(([phase, elapsed]) => [phase, duration(elapsed)])),
  };
}

export function readerOpeningLabel(phase: ReaderOpeningPhase, source: ReaderOpeningFacts["source"]) {
  switch (phase) {
    case "source": return "正在确认打开方式…";
    case "local-read": return "正在读取本机乐谱…";
    case "engine": return "正在准备阅读器…";
    case "file": return source === "offline" ? "正在载入本机文件…" : "正在获取 PDF 文件…";
    case "document": return "正在解析 PDF…";
    case "local-check": return "PDF 已就绪，正在校验本机状态…";
    case "score": return "PDF 已就绪，正在确认乐谱信息…";
    case "page": return "正在显示谱面…";
    case "ready": return "乐谱已打开";
  }
}
