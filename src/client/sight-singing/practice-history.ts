import { z } from 'zod';
import { localDatabase } from '../platform/local-database';
import { currentLocalOwnerKey } from '../platform/local-workspace';
import { savePracticeData, takeKeyPrefix } from './questions';
import type { assessNotes } from './pitch-feedback';

type Feedback = ReturnType<typeof assessNotes>;
const feedbackStatus = z.enum(['inTune', 'sharp', 'flat', 'wrongNote', 'missed', 'insufficientData']);
const takeSchema = z.object({
  id: z.string(), at: z.number(), title: z.string(), questionId: z.string(), version: z.number().nullable(),
  scoreId: z.string(), attachmentId: z.string(), revision: z.number(), first: z.number(), last: z.number(), range: z.string(),
  voiceId: z.string(), voiceName: z.string(), drone: z.boolean(), accompaniment: z.array(z.string()),
  percent: z.number().nullable(), matched: z.number(), total: z.number(),
  notes: z.array(z.object({ measure: z.string(), targets: z.array(z.number()), target: z.number().nullable(),
    sung: z.number().nullable(), cents: z.number().nullable(), interval: z.number().nullable(), status: feedbackStatus })),
});
export type PracticeTake = z.infer<typeof takeSchema>;

export function takeScore(review: Feedback) {
  const total = review.filter(row => row.status !== 'insufficientData').length;
  const matched = review.filter(row => row.status === 'inTune').length;
  return { total, matched, percent: total ? Math.round(100 * matched / total) : null };
}

export async function readTakes(owner: string, drive: string) {
  const prefix = takeKeyPrefix(owner, drive);
  return localDatabase.transaction('r', localDatabase.system, async () => {
    if (await currentLocalOwnerKey() !== owner) return [];
    const rows = await localDatabase.system.where('key').startsWith(prefix).toArray();
    return rows.flatMap(({ key, value }) => {
      try {
        const take = takeSchema.safeParse(JSON.parse(value));
        return take.success && key === prefix + take.data.id ? [take.data] : [];
      } catch { return []; }
    }).sort((a, b) => b.at - a.at);
  });
}

export function saveTake(owner: string, drive: string, take: PracticeTake) {
  return savePracticeData(owner, takeKeyPrefix(owner, drive) + take.id, take);
}
