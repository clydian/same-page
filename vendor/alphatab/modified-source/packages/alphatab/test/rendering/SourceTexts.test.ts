import { MusicXmlImporter } from '@coderline/alphatab/importer/MusicXmlImporter';
import { ByteBuffer } from '@coderline/alphatab/io/ByteBuffer';
import { SourceText, SourceTextPlacement } from '@coderline/alphatab/model/Bar';
import { JsonConverter } from '@coderline/alphatab/model/JsonConverter';
import { NotationElement } from '@coderline/alphatab/NotationSettings';
import { ScoreRenderer } from '@coderline/alphatab/rendering/ScoreRenderer';
import { Settings } from '@coderline/alphatab/Settings';
import { StaveProfile } from '@coderline/alphatab/StaveProfile';
import { describe, expect, it } from 'vitest';

const xml =
    '<score-partwise><part-list><score-part id="P"><part-name>Voice</part-name></score-part></part-list><part id="P"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><type>whole</type></note></measure></part></score-partwise>';
function load() {
    const settings = new Settings();
    settings.core.engine = 'svg';
    settings.core.enableLazyLoading = false;
    settings.display.staveProfile = StaveProfile.Score;
    const importer = new MusicXmlImporter();
    importer.init(ByteBuffer.fromBuffer(new TextEncoder().encode(xml)), settings);
    return { settings, score: importer.readScore() };
}
function render(texts: SourceText[] | null, hidden = false) {
    const { score, settings } = load();
    const bar = score.tracks[0].staves[0].bars[0];
    bar.sourceTexts = texts;
    bar.voices[0].beats[0].text = 'LEGACY';
    if (hidden) {
        settings.notation.elements.set(NotationElement.EffectText, false);
    }
    const renderer = new ScoreRenderer(settings),
        pieces: string[] = [];
    renderer.width = 800;
    renderer.error.on(x => {
        throw x;
    });
    renderer.partialRenderFinished.on(x => {
        if (typeof x.renderResult === 'string') {
            pieces.push(x.renderResult);
        }
    });
    renderer.renderScore(score, [0]);
    renderer.destroy();
    return pieces.join('');
}
const entry = (text: string, placement = SourceTextPlacement.Above, displayStart = 0) =>
    Object.assign(new SourceText(), { text, placement, displayStart });
describe('independent source word directions', () => {
    it('preserves two same-time words in separate above and below bands', () => {
        const svg = render([entry('LAUGH'), entry('SING', SourceTextPlacement.Below)]);
        expect(svg).toContain('LAUGH');
        expect(svg).toContain('SING');
        expect(svg).not.toContain('LEGACY');
        const y = (word: string) => Number(svg.match(new RegExp(`y="([^" ]+)"[^>]*>${word}</text>`))?.[1]);
        expect(y('LAUGH')).toBeLessThan(y('SING'));
    });
    it('keeps multiple authored words on the same lane without overwriting', () => {
        const svg = render([entry('FIRST'), entry('SECOND')]);
        expect(svg).toContain('FIRST');
        expect(svg).toContain('SECOND');
    });
    it('does not quantize offbeat text to an attack', () => {
        const svg = render([
            entry('FIRST', SourceTextPlacement.Above, 480),
            entry('SECOND', SourceTextPlacement.Above, 2400)
        ]);
        expect(svg).toContain('FIRST');
        expect(svg).toContain('SECOND');
    });
    it('keeps legacy null and explicit empty declaration semantics', () => {
        expect(render(null)).toContain('LEGACY');
        expect(render([])).not.toContain('LEGACY');
    });
    it('honors notation hiding and rejects invalid display coordinates', () => {
        expect(render([entry('HIDDEN')], true)).not.toContain('HIDDEN');
        expect(render([entry('BAD', SourceTextPlacement.Above, Number.NaN)])).not.toContain('BAD');
        expect(render([entry('BAD', SourceTextPlacement.Above, 4000)])).not.toContain('BAD');
    });
    it('roundtrips placement/time/literal words through the Worker JSON model', () => {
        const { score, settings } = load();
        score.tracks[0].staves[0].bars[0].sourceTexts = [entry('LAUGH\nGROUP', SourceTextPlacement.Below, 480.5)];
        const restored = JsonConverter.jsObjectToScore(JsonConverter.scoreToJsObject(score), settings);
        expect(restored.tracks[0].staves[0].bars[0].sourceTexts).toEqual(score.tracks[0].staves[0].bars[0].sourceTexts);
    });
    it('preserves authored generic font-family fallback order in actual SVG', () => {
        const text = Object.assign(entry('FONT FAMILY'), { fontFamilies: ['monospace', 'serif'] });
        const svg = render([text]);
        expect(svg).toMatch(/font:[^;]*monospace, serif/);
    });
    it('roundtrips generic font families through the public Worker JSON model', () => {
        const { score, settings } = load();
        const text = Object.assign(entry('SERIF'), { fontFamilies: ['serif'] });
        score.tracks[0].staves[0].bars[0].sourceTexts = [text];
        const restored = JsonConverter.jsObjectToScore(JsonConverter.scoreToJsObject(score), settings);
        expect(restored.tracks[0].staves[0].bars[0].sourceTexts).toEqual([text]);
    });

});
