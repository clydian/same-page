import { getCurrentLocale, getMessages, type AppLocale } from "../../i18n";
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

export function readerOpeningLabel(phase: ReaderOpeningPhase, source: ReaderOpeningFacts["source"], locale: AppLocale = getCurrentLocale()) {
  const t = getMessages(locale, "reader");
  switch (phase) {
    case "source": return t("checkingOpenMode");
    case "local-read": return t("readingLocalScore");
    case "engine": return t("preparingReader");
    case "file": return source === "offline" ? t("openingLocalFile") : t("fetchingPdf");
    case "document": return t("parsingPdf");
    case "local-check": return t("checkingLocalState");
    case "score": return t("checkingScoreDetails");
    case "page": return t("showingScore");
    case "ready": return t("scoreOpened");
  }
}
