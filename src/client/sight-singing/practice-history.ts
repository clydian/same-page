import { z } from 'zod';
import { localDatabase } from '../platform/local-database';
import { currentLocalOwnerKey } from '../platform/local-workspace';
import { assertPracticeOwner, savePracticeData, takeKeyPrefix, takeOwnerKeyPrefix } from './questions';
import type { assessNotes } from './pitch-feedback';

const takeSchema = z.object({
  id: z.string(), at: z.number().nonnegative().max(8.64e15), title: z.string(), questionId: z.string(),
  version: z.number().int().positive().nullable().transform(version => version ?? 1),
  voiceId: z.string(), voiceName: z.string(), percent: z.number().int().min(0).max(100).nullable(),
  published: z.boolean().default(false),
});
export type PracticeTake = z.infer<typeof takeSchema>;

export function takeScore(review: ReturnType<typeof assessNotes>) {
  const total = review.filter(row => row.status !== 'insufficientData').length;
  const matched = review.filter(row => row.status === 'inTune').length;
  return { total, matched, percent: total ? Math.round(100 * matched / total) : null };
}

function parseTake(key: string, value: string, prefix: string) {
  try {
    const take = takeSchema.safeParse(JSON.parse(value));
    return take.success && key === prefix + take.data.id ? take.data : null;
  } catch { return null; }
}

export async function readTakes(owner: string, drive: string) {
  const prefix = takeKeyPrefix(owner, drive);
  return localDatabase.transaction('r', localDatabase.system, async () => {
    if (await currentLocalOwnerKey() !== owner) return [];
    const rows = await localDatabase.system.where('key').startsWith(prefix).toArray();
    return rows.flatMap(({ key, value }) => {
      const take = parseTake(key, value, prefix);
      return take ? [take] : [];
    }).sort((a, b) => b.at - a.at);
  });
}

/** Remove legacy note details and any stored Blob while keeping the score tags. */
export async function compactPracticeHistory(owner: string) {
  await localDatabase.transaction('rw', localDatabase.system, async () => {
    await assertPracticeOwner(owner);
    for (const { key, value, blob } of await localDatabase.system.where('key').startsWith(takeOwnerKeyPrefix(owner)).toArray()) {
      const take = parseTake(key, value, key.slice(0, key.lastIndexOf(':') + 1));
      if (!take || take.percent === null) await localDatabase.system.delete(key);
      else {
        const summary = JSON.stringify(take);
        if (summary !== value || blob) await localDatabase.system.put({ key, value: summary });
      }
    }
  });
}

export function saveTake(owner: string, drive: string, take: PracticeTake, signal?: AbortSignal) {
  const summary = takeSchema.parse(take);
  return savePracticeData(owner, takeKeyPrefix(owner, drive) + summary.id, summary, signal);
}
