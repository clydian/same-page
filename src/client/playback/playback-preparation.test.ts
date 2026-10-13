import { afterEach, expect, it, vi } from 'vitest';
import { clearPlaybackPreparations, readPlaybackPreparation, savePlaybackPreparation } from './playback-preparation';
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
