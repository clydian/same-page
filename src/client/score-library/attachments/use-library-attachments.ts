import { useLiveQuery } from "dexie-react-hooks";
import { attachmentWorkspace, readAttachmentDirectory, captureAttachmentDirectoryWrite, clearAttachmentDirectories } from "./attachment-directory";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { attachmentListSchema, type ScoreAttachment } from "../../../shared/attachments";
import type { ScoreSummary } from "../../../shared/scores";
import { attachmentFetch as diagnosticFetch } from "./request";
import { SettingsRequestError } from "../../settings/settings-request";

const FRESH_MS = 30_000;
const MAX_SCORES = 100;
type ScoreRevision = [string, number, number];
type Entry = { revision: string; items: ScoreAttachment[]; readAt: number; attempt: number };
type Snapshot = { key: string; entries: Map<string, Entry>; failed: boolean; refreshing: boolean };

// Cloud reads belong to one mounted drive view and access generation. The
// separately persisted directory is display metadata, never online authority.
class AttachmentMetadata {
  constructor(private choirId: string, private generation: string, private owner?: string) {}
  private entries = new Map<string, Entry>();
  private listeners = new Set<() => void>();
  private snapshot: Snapshot = { key: "", entries: new Map(), failed: false, refreshing: false };
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(key: string, failed: boolean, refreshing: boolean) {
    this.snapshot = { key, entries: new Map(this.entries), failed, refreshing };
    this.listeners.forEach(listener => listener());
  }
  private trim(visible: Set<string>) {
    for (const id of this.entries.keys()) {
      if (this.entries.size <= Math.max(MAX_SCORES, visible.size)) break;
      if (!visible.has(id)) this.entries.delete(id);
    }
  }
  pause() {
    for (const [id, entry] of this.entries) this.entries.set(id, { ...entry, readAt: -Infinity });
    this.publish(this.snapshot.key, this.snapshot.failed, false);
  }
  load(scoreKey: string, attempt: number, scores: Pick<ScoreSummary, "id" | "updatedAt" | "attachmentCount">[]) {
    const abort = new AbortController();
    const rows = JSON.parse(scoreKey) as ScoreRevision[];
    const visible = new Set(rows.map(row => row[0]));
    this.trim(visible);
    const key = JSON.stringify([this.owner ?? null, this.generation, scoreKey, attempt]);
    const requested = rows.filter(row => {
      const cached = this.entries.get(row[0]);
      return !cached || cached.revision !== JSON.stringify(row) || cached.attempt !== attempt || Date.now() - cached.readAt >= FRESH_MS;
    });
    this.publish(key, false, requested.length > 0);
    void (async () => {
      for (let start = 0; start < requested.length; start += 100) {
        const batch = requested.slice(start, start + 100);
        const query = new URLSearchParams({ scoreIds: batch.map(row => row[0]).join(",") });
        const writers = this.owner ? await Promise.all(batch.map(async row => {
          const workspace = this.owner ? await attachmentWorkspace(this.owner, this.choirId, row[0]).catch(() => null) : null;
          const save = workspace ? await captureAttachmentDirectoryWrite(workspace).catch(() => null) : null;
          return { workspace, save };
        })) : [];
        abort.signal.throwIfAborted();
        const response = await diagnosticFetch(`/api/choirs/${encodeURIComponent(this.choirId)}/attachments?${query}`, { signal: abort.signal });
        abort.signal.throwIfAborted();
        if (!response.ok) {
          if ([401, 403, 404].includes(response.status)) await Promise.all(writers.map(({ workspace }) => workspace ? clearAttachmentDirectories(workspace).catch(() => undefined) : undefined));
          throw new SettingsRequestError(response.status);
        }
        const { attachments } = attachmentListSchema.parse(await response.json());
        if (abort.signal.aborted) return;
        await Promise.all(batch.map((row, index) => {
          const score = scores.find(score => score.id === row[0]);
          return score ? writers[index]?.save?.(score, attachments, abort.signal).catch(() => undefined) : undefined;
        }));
        if (abort.signal.aborted) return;
        for (const row of batch) {
          this.entries.delete(row[0]);
          this.entries.set(row[0], { revision: JSON.stringify(row), items: attachments.filter(item => item.scoreId === row[0]), readAt: Date.now(), attempt });
        }
        this.trim(visible);
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

export function useLibraryAttachments(choirId: string, scores: ScoreSummary[], active: boolean, generation: string, owner?: string) {
  const resource = useMemo(() => new AttachmentMetadata(choirId, generation, owner), [choirId, generation, owner]);
  const snapshot = useSyncExternalStore(resource.subscribe, resource.getSnapshot);
  const [attempt, setAttempt] = useState(0);
  const scoreKey = JSON.stringify(scores.filter(score => (score.attachmentCount ?? 0) > 0).map(score => [score.id, score.updatedAt, score.attachmentCount]));
  const key = JSON.stringify([owner ?? null, generation, scoreKey, attempt]);
  useEffect(() => {
    if (active) return resource.load(scoreKey, attempt, JSON.parse(scoreKey).map(([id, updatedAt, attachmentCount]: ScoreRevision) => ({ id, updatedAt, attachmentCount })));
    resource.pause();
  }, [resource, scoreKey, attempt, active]);
  const restored = useLiveQuery(async () => {
    const entries = new Map<string, Entry>();
    if (owner) for (const row of JSON.parse(scoreKey) as ScoreRevision[]) {
      const score = { id: row[0], updatedAt: row[1], attachmentCount: row[2] };
      const workspace = await attachmentWorkspace(owner, choirId, row[0]).catch(() => null);
      const items = workspace ? await readAttachmentDirectory(workspace, score).catch(() => null) : null;
      if (items) entries.set(row[0], { revision: JSON.stringify(row), items, readAt: 0, attempt: -1 });
    }
    return { key, entries };
  }, [owner, choirId, key]);
  const current = active && snapshot.key === key ? snapshot : undefined;
  const visible = new Map<string, Entry>();
  for (const row of JSON.parse(scoreKey) as ScoreRevision[]) {
    const cached = snapshot.entries.get(row[0]) ?? (restored?.key === key ? restored.entries.get(row[0]) : undefined);
    if (cached?.revision === JSON.stringify(row)) visible.set(row[0], cached);
  }
  const statusFor = (scoreId: string) => visible.has(scoreId) ? "ready" : !active ? owner && restored?.key !== key ? "loading" : "unavailable" : current?.failed ? "error" : "loading";
  return {
    items: [...visible.values()].flatMap(entry => entry.items), statusFor,
    loading: active && scores.some(score => (score.attachmentCount ?? 0) > 0 && statusFor(score.id) === "loading"),
    refreshing: current?.refreshing ?? false, error: current?.failed ?? false,
    retry: () => setAttempt(value => value + 1),
  };
}
