import { localDatabase } from './local-database';
// Additive records in the existing store preserve access for already-open older
// clients: installing this optional feature never upgrades the shared database.
export function musicXmlFiles(scope: { ownerKey: string; choirId?: string; scoreId?: string; attachmentId?: string }) {
  const parts = ['offline-musicxml', scope.ownerKey, ...(scope.choirId ? [scope.choirId] : []), ...(scope.scoreId ? [scope.scoreId] : []), ...(scope.attachmentId ? [scope.attachmentId] : [])];
  return localDatabase.system.where('key').startsWith(JSON.stringify(parts).slice(0, -1) + ',');
}
export function isMusicXmlFileKey(key: string, owner: string) {
  return key.startsWith(JSON.stringify(['offline-musicxml', owner]).slice(0, -1) + ',');
}
