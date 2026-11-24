import { readLogoutFence } from '../auth/logout-fence';
import { localDatabase } from '../platform/local-database';
import { currentLocalOwnerKey } from '../platform/local-workspace';

const prefix = 'same-page:sight-singing:v1:';
const ownerPrefix = (user: string) => `${prefix}${encodeURIComponent(user)}:`;
const questionKeyPrefix = (owner: string, drive: string) => `${ownerPrefix(owner)}${encodeURIComponent(drive)}:`;
const takeOwnerKeyPrefix = (owner: string) => `same-page:sight-singing-takes:v1:${encodeURIComponent(owner)}:`;
export const isSightSingingQuestionKey = (key: string, owner: string) => key.startsWith(ownerPrefix(owner)) || key.startsWith(takeOwnerKeyPrefix(owner));

// Legacy records retain the source tuple until the original revision can be frozen.
export type SightSingingQuestion = {
  id: string;
  title: string;
  scoreId: string | null;
  attachmentId: string | null;
  revision: number | null;
  first: number;
  last: number;
  voice?: string;
  version?: number;
  snapshot?: { name: string; editToken?: string };
};

function isQuestion(value: unknown): value is SightSingingQuestion {
  if (!value || typeof value !== 'object') return false;
  const q = value as Partial<SightSingingQuestion>;
  const library = typeof q.scoreId === 'string' && q.scoreId.length > 0 && typeof q.attachmentId === 'string'
    && q.attachmentId.length > 0 && typeof q.revision === 'number' && Number.isSafeInteger(q.revision) && q.revision > 0;
  const standalone = q.scoreId === null && q.attachmentId === null && q.revision === null && Boolean(q.snapshot);
  return [q.id, q.title].every(part => typeof part === 'string' && part.length > 0)
    && (library || standalone)
    && (q.voice === undefined || typeof q.voice === 'string')
    && (q.version === undefined || Number.isSafeInteger(q.version) && q.version > 0)
    && (q.snapshot === undefined || typeof q.snapshot?.name === 'string' && q.snapshot.name.length > 0)
    && [q.first, q.last].every(part => typeof part === 'number' && Number.isSafeInteger(part) && part >= 0)
    && q.first! <= q.last!;
}

export async function readQuestions(owner: string, drive: string) {
  const scope = questionKeyPrefix(owner, drive);
  return localDatabase.transaction('r', localDatabase.system, async () => {
    if (await currentLocalOwnerKey() !== owner) return [];
    const questions = (await localDatabase.system.where('key').startsWith(scope).toArray()).flatMap(record => {
      try {
        const item: unknown = JSON.parse(record.value);
        return isQuestion(item) && record.key === scope + item.id ? [item] : [];
      } catch { return []; }
    });
    return questions.sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  });
}

export async function readQuestionSnapshot(owner: string, drive: string, id: string, version: number) {
  return localDatabase.transaction('r', localDatabase.system, async () => {
    if (await currentLocalOwnerKey() !== owner || (await readLogoutFence())?.userId === owner.slice('user:'.length)) return null;
    const row = await localDatabase.system.get(questionKeyPrefix(owner, drive) + id);
    if (!row?.blob) return null;
    try {
      const question: unknown = JSON.parse(row.value);
      return isQuestion(question) && question.snapshot && question.version === version ? row.blob : null;
    } catch { return null; }
  });
}
