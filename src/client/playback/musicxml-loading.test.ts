import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getLoadingPerformanceSnapshot, resetLoadingPerformance } from '../performance/loading-performance';
import { musicXmlLoadingTracker, startMusicXmlLoading, stopMusicXmlLoading } from './musicxml-loading';
let clock=0;
beforeEach(()=>{stopMusicXmlLoading();resetLoadingPerformance();clock=100;vi.spyOn(performance,'now').mockImplementation(()=>clock);});
afterEach(()=>{stopMusicXmlLoading();vi.restoreAllMocks();resetLoadingPerformance();});
const records=()=>getLoadingPerformanceSnapshot().records;
it('distinguishes playback readiness from a readable first system and keeps later audio milestones',()=>{
 const tracker=startMusicXmlLoading();clock=200;tracker.stage('ready');
 expect(records().some(r=>r.name==='open-musicxml:duration')).toBe(false);
 clock=350;tracker.stage('first-system');
 expect(records().find(r=>r.name==='open-musicxml:duration')?.duration).toBe(250);
 tracker.stage('play-request');tracker.stage('playing');
 expect(records().map(r=>r.name)).toContain('musicxml:play-request');
 expect(records().map(r=>r.name)).toContain('musicxml:playing');
});
it('fences milestones from superseded opens and records each startup stage once',()=>{
 const old=startMusicXmlLoading(),current=startMusicXmlLoading();
 old.stage('ready');old.stage('first-system');old.source('network');old.end('error');
 expect(records().some(r=>r.name==='musicxml:ready')).toBe(false);
 current.stage('first-system');current.stage('first-system');current.stage('ready');
 expect(records().filter(r=>r.name==='musicxml:first-system')).toHaveLength(1);
 expect(records().filter(r=>r.name==='open-musicxml:duration')).toHaveLength(2);
 expect(records().some(r=>r.name==='musicxml:source:network')).toBe(false);
});
it('ends an abandoned journey and starts a separate retry without restoring its milestones',()=>{
 const first=startMusicXmlLoading();first.source('local');first.stage('raw-ready');first.end('error');
 clock=200;const retry=musicXmlLoadingTracker();first.stage('soundfont-ready');
 retry.source('network');retry.stage('ready');retry.stage('first-system');
 expect(records().filter(r=>r.name==='open-musicxml:start')).toHaveLength(2);
 expect(records().some(r=>r.name==='musicxml:soundfont-ready')).toBe(false);
 expect(records().map(r=>r.name)).toContain('musicxml:source:network');
});
it('bounds repeated playback diagnostics in the journal and Performance mark buffer',()=>{
 const tracker=startMusicXmlLoading();
 for(let index=0;index<150;index++){tracker.stage('play-request');tracker.stage('playing');}
 expect(records()).toHaveLength(100);
 expect(performance.getEntriesByName('same-page:musicxml:play-request')).toHaveLength(1);
 expect(performance.getEntriesByName('same-page:musicxml:playing')).toHaveLength(1);
 expect(records().every(record=>Object.keys(record).every(key=>['name','startTime','duration','journey','cacheCategory'].includes(key)))).toBe(true);
});
it('bounds marks and measures over many successful opens, rather than only within one session',()=>{
 for(let index=0;index<150;index++){
  const tracker=startMusicXmlLoading();tracker.stage('ready');tracker.stage('first-system');tracker.end('cancelled');
 }
 expect(records()).toHaveLength(100);
 expect(performance.getEntriesByName('same-page:open-musicxml:start')).toHaveLength(1);
 expect(performance.getEntriesByName('same-page:musicxml:usable')).toHaveLength(1);
 expect(performance.getEntriesByName('same-page:open-musicxml:duration')).toHaveLength(1);
});
