import { useEffect, useState } from "react";
import { attachmentListSchema, type ScoreAttachment } from "../../../shared/attachments";
import type { ScoreSummary } from "../../../shared/scores";
import { attachmentFetch as diagnosticFetch } from "./request";
import { SettingsRequestError } from "../../settings/settings-request";

export function useLibraryAttachments(choirId: string, scores: ScoreSummary[], active: boolean, generation: string) {
  const [result, setResult] = useState<{ key: string; scope: string; scoreKey: string; attachments: ScoreAttachment[]; loadedIds: string[]; error: boolean }>();
  const [attempt, setAttempt] = useState(0);
  const scoreKey = JSON.stringify(scores.filter(score => (score.attachmentCount ?? 0) > 0).map(score => [score.id, score.updatedAt, score.attachmentCount]));
  const scope = JSON.stringify([choirId, generation]);
  const key = JSON.stringify([scope, scoreKey, attempt]);
  useEffect(() => {
    if (!active) return;
    const abort = new AbortController();
    const ids = (JSON.parse(scoreKey) as [string, number, number][]).map(([id]) => id);
    void (async () => {
      const attachments: ScoreAttachment[] = [];
      for (let start = 0; start < ids.length; start += 100) {
        const query = new URLSearchParams({ scoreIds: ids.slice(start, start + 100).join(",") });
        const response = await diagnosticFetch(`/api/choirs/${encodeURIComponent(choirId)}/attachments?${query}`, { signal: abort.signal });
        if (!response.ok) throw new SettingsRequestError(response.status);
        attachments.push(...attachmentListSchema.parse(await response.json()).attachments);
      }
      if (!abort.signal.aborted) setResult({ key, scope, scoreKey, attachments, loadedIds: ids, error: false });
    })().catch((error: unknown) => {
      if (abort.signal.aborted) return;
      setResult(previous => {
        const revoked = error instanceof SettingsRequestError && [401, 403, 404].includes(error.status);
        const retained = revoked ? new Set<string>() : matchingIds(previous, scope, scoreKey);
        return { key, scope, scoreKey, attachments: previous?.attachments.filter(item => retained.has(item.scoreId)) ?? [], loadedIds: [...retained], error: true };
      });
    });
    return () => abort.abort();
  }, [choirId, key, scope, scoreKey, active, attempt]);
  const current = active && result?.key === key ? result : undefined;
  // Keep unchanged open rows visible when another score is toggled, without
  // reusing content across identity/mutation generations or score revisions.
  const retainedIds = active ? matchingIds(result, scope, scoreKey) : new Set<string>();
  const items = current?.attachments ?? result?.attachments.filter(item => retainedIds.has(item.scoreId)) ?? [];
  const statusFor = (scoreId: string) => !active ? "unavailable" : retainedIds.has(scoreId) ? "ready" : current?.error ? "error" : "loading";
  return { items, statusFor, loading: active && !current, error: current?.error ?? false, retry: () => setAttempt(value => value + 1) };
}

function matchingIds(result: { scope: string; scoreKey: string; loadedIds: string[] } | undefined, scope: string, scoreKey: string) {
  const retained = new Set<string>();
  if (result?.scope === scope) {
    const previous = new Set((JSON.parse(result.scoreKey) as unknown[]).map(value => JSON.stringify(value)));
    for (const entry of JSON.parse(scoreKey) as [string, number, number][]) {
      if (result.loadedIds.includes(entry[0]) && previous.has(JSON.stringify(entry))) retained.add(entry[0]);
    }
  }
  return retained;
}
