import { readLogoutFence } from '../auth/logout-fence';
import { localDatabase } from '../platform/local-database';
import { currentLocalOwnerKey } from '../platform/local-workspace';
import type { PublishedQuestion } from '../../shared/sight-singing';

const prefix = 'same-page:sight-singing:v1:';
const ownerPrefix = (user: string) => `${prefix}${encodeURIComponent(user)}:`;
const questionKeyPrefix = (owner: string, drive: string) => `${ownerPrefix(owner)}${encodeURIComponent(drive)}:`;
const takePrefix = (owner: string) => `same-page:sight-singing-takes:v1:${encodeURIComponent(owner)}:`;
export const isSightSingingQuestionKey = (key: string, owner: string) => key.startsWith(ownerPrefix(owner)) || key.startsWith(takePrefix(owner));
export const takeKeyPrefix = (owner: string, drive: string) => `${takePrefix(owner)}${encodeURIComponent(drive)}:`;

// Older private questions store a voice. Keep it as a default when opened.
export type SightSingingQuestion = Omit<PublishedQuestion, 'version'> & { voice?: string; version?: number };

function isQuestion(value: unknown): value is SightSingingQuestion {
  if (!value || typeof value !== 'object') return false;
  const q = value as Partial<SightSingingQuestion>;
  return [q.id, q.title, q.scoreId, q.attachmentId].every(part => typeof part === 'string' && part.length > 0)
    && (q.voice === undefined || typeof q.voice === 'string')
    && [q.revision, q.first, q.last].every(part => typeof part === 'number' && Number.isSafeInteger(part) && part >= 0)
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

export async function saveQuestion(owner: string, drive: string, question: SightSingingQuestion, signal: AbortSignal) {
  await savePracticeData(owner, questionKeyPrefix(owner, drive) + question.id, question, signal);
}

export async function savePracticeData(owner: string, key: string, value: unknown, signal?: AbortSignal) {
  await localDatabase.transaction('rw', localDatabase.system, async () => {
    if (await currentLocalOwnerKey() !== owner || (await readLogoutFence())?.userId === owner.slice('user:'.length)) {
      throw new Error('local_workspace_owner_changed');
    }
    signal?.throwIfAborted();
    await localDatabase.system.put({ key, value: JSON.stringify(value) });
    signal?.throwIfAborted();
  });
}
