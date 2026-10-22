import { afterEach, expect, it, vi } from 'vitest';
import { acquirePlaybackPreparation, clearPlaybackPreparation, clearPlaybackPreparations, readPlaybackPreparation, savePlaybackPreparation } from './playback-preparation';
import { resetNavigation } from '../settings/navigation-events';
import type { PlaybackSource } from './playback-store';
const source: PlaybackSource = { ownerKey:'user:one', sessionId:'one', choirId:'drive', score:{id:'score',choirId:'drive',fileName:'a.pdf',updatedAt:1,currentVersion:{id:'v',versionNumber:1,sizeBytes:1,sha256:'hash',etag:'etag',pageCount:1,createdAt:1}},attachment:{id:'a',scoreId:'score',kind:'musicxml',name:'a.xml',url:null,revision:1,sizeBytes:1,updatedAt:1,trashExpiresAt:null} };
afterEach(() => { clearPlaybackPreparations(); vi.useRealTimers(); });
it('reuses preparation only in its owning session and attachment revision', () => {
 const bytes = new Uint8Array([1]); savePlaybackPreparation(source,bytes);
 expect(readPlaybackPreparation(source)?.bytes).toBe(bytes);
 for(const next of [{...source,ownerKey:'user:two'},{...source,sessionId:'two'},{...source,choirId:'other'},{...source,attachment:{...source.attachment,revision:2}}]) expect(readPlaybackPreparation(next)).toBeUndefined();
 resetNavigation();expect(readPlaybackPreparation(source)).toBeUndefined();
});
it('expires and evicts preparation instead of retaining unbounded attachment bodies', () => {
 vi.useFakeTimers();savePlaybackPreparation(source,new Uint8Array([1]));vi.advanceTimersByTime(300001);expect(readPlaybackPreparation(source)).toBeUndefined();
 for(let i=0;i<5;i++) savePlaybackPreparation({...source,attachment:{...source.attachment,id:String(i)}},new Uint8Array([1]));
 expect(readPlaybackPreparation({...source,attachment:{...source.attachment,id:'0'}})).toBeUndefined();
 savePlaybackPreparation(source,new Uint8Array(33*1024*1024));expect(readPlaybackPreparation(source)).toBeUndefined();
});

it('retains an active artifact through a long rehearsal and starts idle expiry on release', () => {
 vi.useFakeTimers();
 const lease=acquirePlaybackPreparation(source); lease.save(new Uint8Array([1]));
 vi.advanceTimersByTime(20*60_000); expect(lease.read()?.bytes).toEqual(new Uint8Array([1]));
 lease.release(); vi.advanceTimersByTime(299999); expect(readPlaybackPreparation(source)).toBeDefined();
 vi.advanceTimersByTime(1); expect(readPlaybackPreparation(source)).toBeUndefined();
});
it('capacity pressure evicts idle entries without dropping an active artifact', () => {
 const lease=acquirePlaybackPreparation(source); lease.save(new Uint8Array([1]));
 for(let i=0;i<6;i++) savePlaybackPreparation({...source,attachment:{...source.attachment,id:String(i)}},new Uint8Array([i]));
 expect(lease.read()?.bytes).toEqual(new Uint8Array([1])); lease.release();
});
it('a revoked or reset lease cannot recreate a cleared preparation with a late worker reply', () => {
 const lease=acquirePlaybackPreparation(source); lease.save(new Uint8Array([1]));
 clearPlaybackPreparation(source); lease.save(new Uint8Array([2])); lease.release();
 expect(readPlaybackPreparation(source)).toBeUndefined();
 const second=acquirePlaybackPreparation(source);resetNavigation();second.save(new Uint8Array([3]));second.release();
 expect(readPlaybackPreparation(source)).toBeUndefined();
});
it('does not reuse prepared input across cleanup/denial/workspace epochs or unknown formats', () => {
 savePlaybackPreparation(source,new Uint8Array([1]),undefined,'old-fence');
 expect(readPlaybackPreparation(source,'new-fence')).toBeUndefined();
 const prepared={bytes:new Uint8Array([1]),importInputVersion:'future-version',dynamicEventsByPart:[],partsWithExplicitDynamics:[],partsWithVoiceScopedDynamics:[]};
 savePlaybackPreparation(source,new Uint8Array([1]),prepared,'current-fence');
 expect(readPlaybackPreparation(source,'current-fence')).toBeUndefined();
});
