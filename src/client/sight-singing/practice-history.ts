import { z } from 'zod';
import {
  currentSingingScoringRule, legacySingingScoringRule, sightSingingScoreSchema, sightSingingScoringRuleSchema, sightSingingSpeedSchema,
} from '../../shared/sight-singing-results';
import { localDatabase } from '../platform/local-database';
import { currentLocalOwnerKey } from '../platform/local-workspace';
import { assertPracticeOwner, takeKeyPrefix, takeOwnerKeyPrefix } from './questions';

const takeSchema = z.object({
  id: z.string(), at: z.number().nonnegative().max(8.64e15), title: z.string(), questionId: z.string(),
  version: z.number().int().positive().nullable().transform(version => version ?? 1),
  voiceId: z.string(), voiceName: z.string(), percent: sightSingingScoreSchema.nullable(),
  published: z.boolean().default(false),
  speed: sightSingingSpeedSchema.optional(),
  scoringRule: sightSingingScoringRuleSchema.default(legacySingingScoringRule),
});
export type PracticeTake = z.infer<typeof takeSchema>;

const takeGroup = ({ questionId, version, scoringRule, voiceId }: PracticeTake) => {
  const group = `${questionId}:${version}`;
  if (scoringRule === legacySingingScoringRule) return group;
  return scoringRule === currentSingingScoringRule ? `${group}:${scoringRule}:${voiceId}` : `${group}:${scoringRule}`;
};

function parseTake(key: string, value: string, prefix: string) {
  try {
    const take = takeSchema.safeParse(JSON.parse(value));
    if (!take.success) return null;
    return key === prefix + take.data.id || key === prefix + takeGroup(take.data) ? take.data : null;
  } catch { return null; }
}

const bestFirst = (a: PracticeTake, b: PracticeTake) => (b.percent ?? -1) - (a.percent ?? -1) || a.at - b.at;

export async function readTakes(owner: string, drive: string) {
  const prefix = takeKeyPrefix(owner, drive);
  return localDatabase.transaction('r', localDatabase.system, async () => {
    if (await currentLocalOwnerKey() !== owner) return [];
    const rows = await localDatabase.system.where('key').startsWith(prefix).toArray();
    const ordered = rows.flatMap(({ key, value }) => {
      const take = parseTake(key, value, prefix);
      return take?.percent != null ? [take] : [];
    }).sort(bestFirst);
    const best = new Map<string, PracticeTake>();
    for (const take of ordered) if (!best.has(takeGroup(take))) best.set(takeGroup(take), take);
    return [...best.values()].sort((a, b) => b.at - a.at);
  });
}

/** Remove legacy note details and any stored Blob while keeping the score tags. */
export async function compactPracticeHistory(owner: string) {
  await localDatabase.transaction('rw', localDatabase.system, async () => {
    await assertPracticeOwner(owner);
    const prefix = takeOwnerKeyPrefix(owner);
    for (const { key, value, blob } of await localDatabase.system.where('key').startsWith(prefix).toArray()) {
      const take = parseTake(key, value, key.slice(0, key.indexOf(':', prefix.length) + 1));
      if (!take || take.percent === null) await localDatabase.system.delete(key);
      else {
        const summary = JSON.stringify(take);
        if (summary !== value || blob) await localDatabase.system.put({ key, value: summary });
      }
    }
  });
}

export async function saveTake(owner: string, drive: string, take: PracticeTake, signal?: AbortSignal) {
  const summary = takeSchema.parse(take);
  if (summary.percent === null) return false;
  const prefix = takeKeyPrefix(owner, drive), group = takeGroup(summary);
  return localDatabase.transaction('rw', localDatabase.system, async () => {
    await assertPracticeOwner(owner);
    signal?.throwIfAborted();
    const rows = await localDatabase.system.where('key').startsWith(prefix).toArray();
    const previous = rows.flatMap(({ key, value }) => {
      const other = parseTake(key, value, prefix);
      return other?.percent != null && takeGroup(other) === group ? [other] : [];
    }).sort(bestFirst)[0];
    if (previous && previous.id !== summary.id && bestFirst(previous, summary) <= 0) return false;
    const current = previous?.id === summary.id ? { ...previous, published: previous.published || summary.published } : summary;
    await localDatabase.system.put({ key: prefix + group, value: JSON.stringify(current) });
    signal?.throwIfAborted();
    return true;
  });
}

export async function markTakeWithdrawn(owner: string, drive: string, id: string) {
  const prefix = takeKeyPrefix(owner, drive);
  await localDatabase.transaction('rw', localDatabase.system, async () => {
    await assertPracticeOwner(owner);
    for (const { key, value } of await localDatabase.system.where('key').startsWith(prefix).toArray()) {
      const take = parseTake(key, value, prefix);
      if (take?.id === id && take.published) await localDatabase.system.put({ key, value: JSON.stringify({ ...take, published: false }) });
    }
  });
}
