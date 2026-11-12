import assert from 'node:assert/strict';
import test from 'node:test';
import { playbackAudioSession } from '../dist/playback-audio-session.js';

const iphone = { userAgent: 'iPhone', platform: 'iPhone', maxTouchPoints: 5 };
test('intentional playback acquires lazily and restores the original type across repeated requests', () => {
  const session = { type: 'auto' };
  const audio = playbackAudioSession({ ...iphone, audioSession: session });
  assert.equal(session.type, 'auto');
  assert.equal(audio.request(), undefined);
  audio.request(); assert.equal(session.type, 'playback');
  audio.release(); assert.equal(session.type, 'auto');
  audio.release(); assert.equal(session.type, 'auto');
  audio.request(); audio.release(); assert.equal(session.type, 'auto');
});
test('release preserves a category subsequently selected by another audio owner', () => {
  const session = { type: 'ambient' };
  const audio = playbackAudioSession({ ...iphone, audioSession: session });
  audio.request(); session.type = 'play-and-record'; audio.release();
  assert.equal(session.type, 'play-and-record');
});
test('missing, rejected and ignored declarations produce actionable iOS advice without throwing', () => {
  for (const session of [undefined, { get type() { return 'auto'; }, set type(_) { throw new Error('unsupported'); } }, { get type() { return 'auto'; }, set type(_) {} }]) {
    const audio = playbackAudioSession({ ...iphone, audioSession: session });
    assert.match(audio.request(), /若无声，请关闭静音模式并检查媒体音量/);
    audio.release();
  }
  const audio = playbackAudioSession({ ...iphone, get audioSession() { throw new Error('blocked'); } });
  assert.match(audio.request(), /若无声/); audio.release();
});
test('iPad desktop identity receives advice; unsupported non-iOS browsers remain silent', () => {
  assert.match(playbackAudioSession({ userAgent: 'Macintosh', platform: 'MacIntel', maxTouchPoints: 5 }).request(), /若无声/);
  assert.equal(playbackAudioSession({ userAgent: 'Macintosh', platform: 'MacIntel', maxTouchPoints: 0 }).request(), undefined);
});
test('a rejected release never prevents teardown', () => {
  let type = 'auto', reject = false;
  const session = { get type() { return type; }, set type(value) { if (reject) throw new Error('blocked'); type = value; } };
  const audio = playbackAudioSession({ ...iphone, audioSession: session });
  audio.request(); reject = true; assert.doesNotThrow(() => audio.release());
});
