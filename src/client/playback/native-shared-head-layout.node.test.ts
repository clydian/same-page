import assert from 'node:assert/strict';
import { test } from 'vitest';
import * as alphaTab from '@coderline/alphatab';
import { loadMusicXml } from '@same-page/player/engine';

// Owned minimal input: the third voice places an extreme head on the wrong
// side for opposing-stem sharing. No published score is embedded here.
const note = (step: string, duration: number, voice: number, stem: string) => `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>${duration}</duration><voice>${voice}</voice><type>${duration === 1 ? 'quarter' : 'half'}</type>${stem ? `<stem>${stem}</stem>` : ''}</note>`;
function source(reverse: boolean) {
  return `<score-partwise version="4.0"><part-list><score-part id="P"><part-name>Piano</part-name></score-part></part-list><part id="P"><measure number="1"><attributes><divisions>1</divisions><time><beats>2</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>${note('G', 1, 1, reverse ? 'down' : 'up')}${note('G', 1, 1, reverse ? 'down' : 'up')}<backup><duration>2</duration></backup>${note('F', 2, 2, reverse ? 'up' : 'down')}<backup><duration>2</duration></backup>${note('G', 2, 3, reverse ? 'up' : '')}</measure></part></score-partwise>`;
}
for (const horizontal of [false, true]) for (const reverse of [false, true]) {
  test(`installed native renders displaced shared head (${horizontal ? 'Horizontal' : 'Page'}, reversed=${reverse})`, () => {
    const settings = new alphaTab.Settings();
    settings.core.engine = 'svg'; settings.core.enableLazyLoading = false;
    settings.display.staveProfile = alphaTab.StaveProfile.Score;
    if (horizontal) settings.display.layoutMode = alphaTab.LayoutMode.Horizontal;
    const score = loadMusicXml(new TextEncoder().encode(source(reverse)), settings);
    const renderer = new alphaTab.rendering.ScoreRenderer(settings), pieces: string[] = [], errors: unknown[] = [];
    renderer.width = 800;
    renderer.error.on(error => errors.push(error));
    renderer.partialRenderFinished.on(event => { if (typeof event.renderResult === 'string') pieces.push(event.renderResult); });
    try {
      assert.doesNotThrow(() => renderer.renderScore(score, [0]));
      assert.deepEqual(errors, []);
      assert.ok(pieces.length > 0);
      assert.doesNotMatch(pieces.join(''), /NaN|Infinity/);
      assert.equal(score.tracks[0].staves[0].bars[0].voices.flatMap(v => v.beats.flatMap(b => b.notes)).length, 4);
    } finally { renderer.destroy(); }
  });
}
