import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { attachmentListSchema, type ScoreAttachment } from "../../../shared/attachments";
import type { ScoreSummary } from "../../../shared/scores";
import { diagnosticFetch } from "../../diagnostics/diagnostics";
import { SettingsRequestError } from "../../settings/settings-request";

const FRESH_MS = 30_000;
const MAX_SCORES = 100;
type ScoreRevision = [string, number, number];
type Entry = { revision: string; items: ScoreAttachment[]; readAt: number; attempt: number };
type Snapshot = { key: string; entries: Map<string, Entry>; failed: boolean; refreshing: boolean };

// This resource belongs to one mounted drive view and access generation. No
// document bodies, persisted cache, or cross-session authority live here.
class AttachmentMetadata {
  constructor(private choirId: string, private generation: string, private active: boolean) {}
  private entries = new Map<string, Entry>();
  private listeners = new Set<() => void>();
  private snapshot: Snapshot = { key: "", entries: new Map(), failed: false, refreshing: false };
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(key: string, failed: boolean, refreshing: boolean) {
    this.snapshot = { key, entries: new Map(this.entries), failed, refreshing };
    this.listeners.forEach(listener => listener());
  }
  load(scoreKey: string, attempt: number) {
    if (!this.active) return;
    const abort = new AbortController();
    const rows = JSON.parse(scoreKey) as ScoreRevision[];
    const key = JSON.stringify([this.generation, scoreKey, attempt]);
    const requested = rows.filter(row => {
      const cached = this.entries.get(row[0]);
      return !cached || cached.revision !== JSON.stringify(row) || cached.attempt !== attempt || Date.now() - cached.readAt >= FRESH_MS;
    });
    this.publish(key, false, requested.length > 0);
    void (async () => {
      for (let start = 0; start < requested.length; start += 100) {
        const batch = requested.slice(start, start + 100);
        const query = new URLSearchParams({ scoreIds: batch.map(row => row[0]).join(",") });
        const response = await diagnosticFetch(`/api/choirs/${encodeURIComponent(this.choirId)}/attachments?${query}`, { signal: abort.signal });
        if (!response.ok) throw new SettingsRequestError(response.status);
        const { attachments } = attachmentListSchema.parse(await response.json());
        if (abort.signal.aborted) return;
        for (const row of batch) {
          this.entries.delete(row[0]);
          this.entries.set(row[0], { revision: JSON.stringify(row), items: attachments.filter(item => item.scoreId === row[0]), readAt: Date.now(), attempt });
        }
        const visible = new Set(rows.map(row => row[0]));
        for (const id of this.entries.keys()) {
          if (this.entries.size <= Math.max(MAX_SCORES, visible.size)) break;
          if (!visible.has(id)) this.entries.delete(id);
        }
        this.publish(key, false, start + 100 < requested.length);
      }
    })().catch((error: unknown) => {
      if (abort.signal.aborted) return;
      if (error instanceof SettingsRequestError && [401, 403, 404].includes(error.status)) this.entries.clear();
      this.publish(key, true, false);
    });
    return () => abort.abort();
  }
}

export function useLibraryAttachments(choirId: string, scores: ScoreSummary[], active: boolean, generation: string) {
  const resource = useMemo(() => new AttachmentMetadata(choirId, generation, active), [choirId, generation, active]);
  const snapshot = useSyncExternalStore(resource.subscribe, resource.getSnapshot);
  const [attempt, setAttempt] = useState(0);
  const scoreKey = JSON.stringify(scores.filter(score => (score.attachmentCount ?? 0) > 0).map(score => [score.id, score.updatedAt, score.attachmentCount]));
  const key = JSON.stringify([generation, scoreKey, attempt]);
  useEffect(() => {
    if (active) return resource.load(scoreKey, attempt);
  }, [resource, scoreKey, attempt, active]);
  const current = active && snapshot.key === key ? snapshot : undefined;
  const visible = new Map<string, Entry>();
  if (active) for (const row of JSON.parse(scoreKey) as ScoreRevision[]) {
    const cached = snapshot.entries.get(row[0]);
    if (cached?.revision === JSON.stringify(row)) visible.set(row[0], cached);
  }
  const statusFor = (scoreId: string) => !active ? "unavailable" : visible.has(scoreId) ? "ready" : current?.failed ? "error" : "loading";
  return {
    items: [...visible.values()].flatMap(entry => entry.items), statusFor,
    loading: active && scores.some(score => (score.attachmentCount ?? 0) > 0 && statusFor(score.id) === "loading"),
    refreshing: current?.refreshing ?? false, error: current?.failed ?? false,
    retry: () => setAttempt(value => value + 1),
  };
}
