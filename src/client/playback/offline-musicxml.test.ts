import { Blob as NodeBlob } from 'node:buffer';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { musicXmlFiles } from '../platform/musicxml-files';
import { localDatabase } from '../platform/local-database';
import { activateAuthenticatedLocalOwner, createLocalWorkspace } from '../platform/local-workspace';
import { clearLocalFiles } from '../offline/local-files';
import { captureAttachmentDirectoryWrite } from '../score-library/attachments/attachment-directory';
import { beginLogout } from '../auth/logout-fence';
import { clearPrivateLocalDataAfterLogout } from '../auth/logout-local-data';
import { captureMusicXmlWrite, readOfflineMusicXml, revokeOfflineMusicXml } from './offline-musicxml';
import { resetNavigation } from '../settings/navigation-events';
import type { PlaybackSource } from './playback-store';
import { offlinePlayerAssetsReady } from './offline-player-assets';
vi.mock('./offline-player-assets', () => ({ offlinePlayerAssetsReady: vi.fn(async () => true) }));
vi.mock('../offline/offline-score-verification', async original => ({ ...await original<typeof import('../offline/offline-score-verification')>(), findVerifiedOfflineScore: vi.fn(async () => ({})) }));
const source: PlaybackSource = { ownerKey:'user:one',sessionId:'session',choirId:'drive',score:{id:'score',choirId:'drive',fileName:'a.pdf',updatedAt:1,attachmentCount:1,currentVersion:{id:'v',versionNumber:1,sizeBytes:1,sha256:'hash',etag:'etag',pageCount:1,createdAt:1}},attachment:{id:'a',scoreId:'score',kind:'musicxml',name:'a.xml',url:null,revision:1,sizeBytes:4,updatedAt:1,trashExpiresAt:null} };
const signal = () => new AbortController().signal;
const bytes = new Uint8Array([80,75,3,4]);
beforeEach(async () => {
 vi.stubGlobal('Blob',NodeBlob);
 vi.mocked(offlinePlayerAssetsReady).mockResolvedValue(true);
 await localDatabase.open();
 await activateAuthenticatedLocalOwner('one');
 const workspace = createLocalWorkspace('user:one' as never,'drive','score');
 await (await captureAttachmentDirectoryWrite(workspace))(source.score,[source.attachment],signal());
});
afterEach(() => vi.unstubAllGlobals());
it('persists original XML/MXL bytes across memory lifetimes, isolates revision and verifies stored contents',async()=>{
 await (await captureMusicXmlWrite(source,signal()))(bytes);
 expect(await readOfflineMusicXml(source)).toEqual(bytes);
 expect(await readOfflineMusicXml({...source,score:{...source.score,attachmentCount:undefined,updatedAt:999}})).toEqual(bytes);
 expect(await readOfflineMusicXml({...source,attachment:{...source.attachment,revision:2}})).toBeNull();
 const record = (await musicXmlFiles({ownerKey:'user:one'}).toArray())[0];
 await localDatabase.system.put({...record,blob:new NodeBlob([new Uint8Array([0,0,0,0])]) as Blob});
 expect(await readOfflineMusicXml(source)).toBeNull();
});
it('rejects late writes after file cleanup, denial, navigation reset and switching away and back',async()=>{
 for (const invalidate of [
  () => clearLocalFiles({ownerKey:'user:one' as never}),
  () => revokeOfflineMusicXml(source),
  async () => resetNavigation(),
  async () => { await activateAuthenticatedLocalOwner('two'); await localDatabase.open();
 await activateAuthenticatedLocalOwner('one'); },
 ]) {
  const save = await captureMusicXmlWrite(source,signal());
  await invalidate();
  await expect(save(bytes)).rejects.toThrow();
 }
 expect(await musicXmlFiles({ownerKey:'user:one'}).count()).toBe(0);
});
it('logout deletes XML without retaining it under the guest owner and fences pending writes',async()=>{
 const pending = await captureMusicXmlWrite(source,signal());
 await pending(bytes);
 await clearPrivateLocalDataAfterLogout();
 expect(await musicXmlFiles({ownerKey:'user:one'}).count()).toBe(0);
 await expect(pending(bytes)).rejects.toThrow();
});
it('does not certify partial resources; abort, quota failure and size mismatch preserve an existing revision',async()=>{
 const save = await captureMusicXmlWrite(source,signal()); await save(bytes);
 vi.mocked(offlinePlayerAssetsReady).mockResolvedValue(false);
 expect(await readOfflineMusicXml(source)).toBeNull();
 const controller=new AbortController(); const aborted=await captureMusicXmlWrite(source,controller.signal); controller.abort();
 await expect(aborted(bytes)).rejects.toThrow();
 await expect(save(new Uint8Array([1]))).rejects.toThrow('musicxml_size_mismatch');
 const put=vi.spyOn(localDatabase.system,'put').mockRejectedValueOnce(new DOMException('full','QuotaExceededError'));
 await expect(save(bytes)).rejects.toThrow('full'); put.mockRestore();
 vi.mocked(offlinePlayerAssetsReady).mockResolvedValue(true);
 expect(await readOfflineMusicXml(source)).toEqual(bytes);
});

it('captures navigation identity before async workspace reads can finish',async()=>{
 const capture=captureMusicXmlWrite(source,signal());resetNavigation();
 const save=await capture;await expect(save(bytes)).rejects.toThrow('offline_identity_changed');
});

it('a persisted logout fence blocks both reads and late writes before cleanup starts',async()=>{
 const save=await captureMusicXmlWrite(source,signal());await save(bytes);
 await beginLogout('one','session');
 await expect(save(bytes)).rejects.toThrow('offline_identity_changed');
 await expect(readOfflineMusicXml(source)).rejects.toThrow('offline_identity_changed');
});

it('a late denial cannot clear a newly active navigation lifetime',async()=>{
 await (await captureMusicXmlWrite(source,signal()))(bytes);
 const revocation=revokeOfflineMusicXml(source);resetNavigation();await revocation;
 expect(await readOfflineMusicXml(source)).toEqual(bytes);
});
