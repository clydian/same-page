import { expect, it, vi } from 'vitest';
import type { PlayerSession, PlayerState } from '@itscly2026/chorus-player';
import { rememberPractice } from './practice-preferences';
import { playbackStore, startPlayback, type PlaybackSource } from './playback-store';
import { observeNavigationSession } from '../settings/navigation-events';
function player() {
  let state: PlayerState = { status:'preparing',message:'',playing:false,parts:[{id:0,name:'Alto',volume:.75,muted:false,solo:false}],measures:[],measure:0,speed:1,focus:null,loop:null };
  const listeners = new Set<() => void>();
  const update = (next: Partial<PlayerState>) => { state={...state,...next}; listeners.forEach(fn=>fn()); };
  const session: PlayerSession = {
    getSnapshot:()=>state, subscribe(fn){listeners.add(fn);return()=>{listeners.delete(fn);};},
    speed:vi.fn(speed=>update({speed})), mix:vi.fn((id,value)=>update({parts:state.parts.map(p=>p.id===id?{...p,...value}:p),focus:'custom'})),
    seek:vi.fn(measure=>update({measure})),focus:vi.fn(focus=>update({focus})),loop:vi.fn(),pause:vi.fn(),playPause:vi.fn(),dispose:vi.fn(),
  };
  return {session,update};
}
const source: PlaybackSource = { ownerKey:'user:one',sessionId:'session',choirId:'drive',
  score: { id:'score',choirId:'drive',fileName:'a.pdf',updatedAt:1,currentVersion:{id:'v',sha256:'hash',etag:'etag',versionNumber:1,sizeBytes:10,pageCount:1,createdAt:1} },
  attachment:{id:'attachment',scoreId:'score',name:'a.mxl',kind:'musicxml',url:null,sizeBytes:5,revision:1,updatedAt:1,trashExpiresAt:null} };
it('restores private practice only after readiness and never overwrites with loading defaults',()=>{
 localStorage.clear();
 const first=player();const release=rememberPractice(first.session,source);first.update({status:'ready'});first.session.speed(.75);first.session.mix(0,{volume:.4});first.session.seek(3);release();
 const second=player();rememberPractice(second.session,source);expect(second.session.speed).not.toHaveBeenCalled();second.update({status:'ready'});
 expect(second.session.getSnapshot()).toMatchObject({speed:.75,measure:3,focus:'custom',parts:[{volume:.4}]});
});
it('a new identity or attachment revision does not inherit old track mix',()=>{
 for (const next of [{...source,ownerKey:'user:other'},{...source,attachment:{...source.attachment,revision:2}}]) {
  const current=player();rememberPractice(current.session,next);current.update({status:'ready'});expect(current.session.speed).not.toHaveBeenCalled();expect(current.session.mix).not.toHaveBeenCalled();
 }
});

it('clears the active source on confirmed session replacement or logout', () => {
 observeNavigationSession('first');
 startPlayback(source);
 observeNavigationSession('first');
 expect(playbackStore.getSnapshot()).toBe(source);
 observeNavigationSession('second');
 expect(playbackStore.getSnapshot()).toBeNull();
 startPlayback(source);
 observeNavigationSession(null);
 expect(playbackStore.getSnapshot()).toBeNull();
});
