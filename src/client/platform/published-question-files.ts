import { localDatabase } from './local-database';

export const publishedQuestionFilePrefix = (owner: string, driveId?: string) =>
  JSON.stringify(['offline-sight-singing', owner, ...(driveId ? [driveId] : [])]).slice(0, -1) + ',';

export const publishedQuestionStorageId = (id: string) => `sight-singing:${id}`;
export const isPublishedQuestionStorageId = (id?: string) => id?.startsWith('sight-singing:') ?? false;

export function publishedQuestionFiles(owner: string, driveId?: string, id?: string) {
  const prefix = publishedQuestionFilePrefix(owner, driveId);
  return localDatabase.system.where('key').startsWith(id ? prefix + JSON.stringify(id) + ',' : prefix);
}
