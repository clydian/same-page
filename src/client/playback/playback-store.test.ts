import { expect, it } from 'vitest';
import { playbackStore, playbackViewStore, stopPlayback, setPlaybackView, startPlayback, type PlaybackSource } from './playback-store';
import { observeNavigationSession } from '../settings/navigation-events';
const source: PlaybackSource = { ownerKey:'user:one',sessionId:'session',choirId:'drive',
  score: { id:'score',choirId:'drive',fileName:'a.pdf',updatedAt:1,currentVersion:{id:'v',sha256:'hash',etag:'etag',versionNumber:1,sizeBytes:10,pageCount:1,createdAt:1} },
  attachment:{id:'attachment',scoreId:'score',name:'a.mxl',kind:'musicxml',url:null,sizeBytes:5,revision:1,updatedAt:1,trashExpiresAt:null} };
it('clears the active source on confirmed session replacement or logout', () => {
 observeNavigationSession('first');
 startPlayback(source);
 setPlaybackView('xml');
 observeNavigationSession('first');
 expect(playbackStore.getSnapshot()).toMatchObject(source);
 expect(playbackViewStore.getSnapshot()).toBe('xml');
 observeNavigationSession('second');
 expect(playbackStore.getSnapshot()).toBeNull();
 expect(playbackViewStore.getSnapshot()).toBe('pdf');
 startPlayback(source);
 observeNavigationSession(null);
 expect(playbackStore.getSnapshot()).toBeNull();
});

it('switches views without changing source and opens another XML in notation', () => {
 startPlayback(source);
 setPlaybackView('xml');
 expect(playbackStore.getSnapshot()).toMatchObject(source);
 setPlaybackView('pdf');
 expect(playbackStore.getSnapshot()).toMatchObject(source);
 setPlaybackView('xml');
 startPlayback({...source, score: {...source.score, id: 'another'}});
 expect(playbackViewStore.getSnapshot()).toBe('xml');
});

it('a newly selected recording starts on PDF and cannot display XML', () => {
 stopPlayback(); startPlayback(source); setPlaybackView('xml');
 const audio: PlaybackSource = {...source, attachment: {...source.attachment, id: 'audio', kind: 'audio'}};
 startPlayback(audio);
 expect(playbackStore.getSnapshot()).toMatchObject(audio);
 expect(playbackViewStore.getSnapshot()).toBe('pdf');
 setPlaybackView('xml');
 expect(playbackViewStore.getSnapshot()).toBe('pdf');
 setPlaybackView('compare');
 expect(playbackViewStore.getSnapshot()).toBe('pdf');
 startPlayback(source);
 expect(playbackViewStore.getSnapshot()).toBe('xml');
 stopPlayback();
});

it('every explicit attachment opening starts a fresh playback generation', () => {
 startPlayback(source); const generation = playbackStore.getGeneration(); const previous = playbackStore.getSnapshot(); setPlaybackView('xml');
 startPlayback(source);
 expect(playbackStore.getGeneration()).toBe(generation + 1);
 expect(playbackStore.getSnapshot()).not.toBe(previous);
 expect(playbackStore.getSnapshot()).toMatchObject(source);
 expect(playbackViewStore.getSnapshot()).toBe('xml');
 stopPlayback();
});

it('switching views retains the same session and generation', () => {
 startPlayback(source); const previous = playbackStore.getSnapshot(), generation = playbackStore.getGeneration();
 setPlaybackView('pdf'); setPlaybackView('compare');
 expect(playbackViewStore.getSnapshot()).toBe('compare'); setPlaybackView('xml');
 expect(playbackStore.getGeneration()).toBe(generation); expect(playbackStore.getSnapshot()).toBe(previous);
 stopPlayback();
});
