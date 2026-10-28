import { expect, it } from 'vitest';
import { InstallProgressTracker } from '../service-worker/install-progress.ts';
import { parseInstallProgress } from '../src/shared/update-progress.ts';

it('keeps streamed reception separate from verified storage and final readiness',()=>{
 const snapshots=[];
 const tracker=new InstallProgressTracker('abc1234',10,p=>snapshots.push({...p,sequence:snapshots.length+1}));
 const cached={url:'/cached',bytes:4},download={url:'/download',bytes:6};
 tracker.prepared(cached,true);tracker.receive(download,3);
 expect(snapshots.at(-1)).toMatchObject({stage:'downloading',preparedBytes:4,reusedBytes:4,downloadedBytes:3});
 tracker.receive(download,0);tracker.receive(download,6);
 expect(snapshots.at(-1).preparedBytes).toBe(4);
 tracker.prepared(download,false);tracker.finish('verifying');
 expect(snapshots.at(-1)).toMatchObject({stage:'verifying',preparedBytes:10,reusedBytes:4,downloadedBytes:6});
 tracker.finish('ready');
 expect(snapshots.every(p=>parseInstallProgress(p)!==null)).toBe(true);
 tracker.receive(download,7); expect(snapshots.at(-1).downloadedBytes).toBe(6);
 expect(parseInstallProgress({...snapshots.at(-1),reusedBytes:11})).toBeNull();
 expect(parseInstallProgress({...snapshots.at(-1),stage:'ready',preparedBytes:9})).toBeNull();
});
