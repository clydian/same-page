import { expect, test } from 'vitest';
import { playbackMeasureLabels } from '@clydian/chorus-player/playback-measures';

test('installed engine disambiguates every repeated visit, without treating printed numbering as sequence', () => {
  expect(playbackMeasureLabels(['0', '17', '18a'])).toEqual(['第 0 小节', '第 17 小节', '第 18a 小节']);
  expect(playbackMeasureLabels(['1', '2', '1', '2', '3'])).toEqual([
    '第 1 小节 · 第 1 次经过', '第 2 小节 · 第 1 次经过',
    '第 1 小节 · 第 2 次经过', '第 2 小节 · 第 2 次经过', '第 3 小节',
  ]);
  expect(playbackMeasureLabels(['12', '12'])).toEqual(['第 12 小节 · 第 1 次经过', '第 12 小节 · 第 2 次经过']);
});
