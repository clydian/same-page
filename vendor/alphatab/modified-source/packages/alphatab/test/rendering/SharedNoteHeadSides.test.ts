import { MusicXmlImporter } from '@coderline/alphatab/importer/MusicXmlImporter';
import { ByteBuffer } from '@coderline/alphatab/io/ByteBuffer';
import { LayoutMode } from '@coderline/alphatab/LayoutMode';
import { ScoreRenderer } from '@coderline/alphatab/rendering/ScoreRenderer';
import { Settings } from '@coderline/alphatab/Settings';
import { StaveProfile } from '@coderline/alphatab/StaveProfile';
import { describe, expect, it } from 'vitest';

const note = (pitch: string, duration: number, voice: number, stem: string) =>
    `<note><pitch><step>${pitch}</step><octave>4</octave></pitch><duration>${duration}</duration><voice>${voice}</voice><type>${duration === 1 ? 'quarter' : 'half'}</type>${stem ? `<stem>${stem}</stem>` : ''}</note>`;
function source(third = true, reverse = false) {
    return `<score-partwise version="4.0"><part-list><score-part id="P"><part-name>Piano</part-name></score-part></part-list><part id="P"><measure number="1"><attributes><divisions>1</divisions><time><beats>2</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>${note('G', 1, 1, reverse ? 'down' : 'up')}${note('G', 1, 1, reverse ? 'down' : 'up')}<backup><duration>2</duration></backup>${note('F', 2, 2, reverse ? 'up' : 'down')}${third ? `<backup><duration>2</duration></backup>${note('G', 2, 3, reverse ? 'up' : '')}` : ''}</measure></part></score-partwise>`;
}
function render(xml: string, horizontal = false) {
    const settings = new Settings();
    settings.core.engine = 'svg';
    settings.core.enableLazyLoading = false;
    settings.display.staveProfile = StaveProfile.Score;
    if (horizontal) {
        settings.display.layoutMode = LayoutMode.Horizontal;
    }
    const importer = new MusicXmlImporter();
    importer.init(ByteBuffer.fromBuffer(new TextEncoder().encode(xml)), settings);
    const score = importer.readScore(),
        renderer = new ScoreRenderer(settings),
        svg: string[] = [],
        errors: unknown[] = [];
    renderer.width = 800;
    renderer.error.on(e => errors.push(e));
    renderer.partialRenderFinished.on(e => {
        if (typeof e.renderResult === 'string') {
            svg.push(e.renderResult);
        }
    });
    const original = score.tracks[0].staves[0].bars[0].voices.flatMap(v => v.beats.flatMap(b => b.notes));
    expect(() => renderer.renderScore(score, [0])).not.toThrow();
    renderer.destroy();
    expect(errors).toEqual([]);
    expect(svg.length).toBeGreaterThan(0);
    expect(svg.join('')).not.toContain('NaN');
    expect(original.length).toBeGreaterThanOrEqual(2);
    return svg.join('');
}
describe('notehead sharing across correct and displaced group sides', () => {
    for (const horizontal of [false, true]) {
        for (const reverse of [false, true]) {
            it(`renders displaced group extreme with ${reverse ? 'reversed' : 'normal'} stems in ${horizontal ? 'Horizontal' : 'Page'}`, () => {
                render(source(true, reverse), horizontal);
            });
        }
    }
    it('preserves two-voice layout with no displaced third voice', () => {
        render(source(false));
    });
});

it('still aligns legal matching black heads on opposite stems', () => {
    const xml = source(false)
        .replaceAll('<duration>2</duration>', '<duration>1</duration>')
        .replace('<beats>2</beats>', '<beats>1</beats>')
        .replace(note('G', 1, 1, 'up') + note('G', 1, 1, 'up'), note('G', 1, 1, 'up'))
        .replace(note('F', 2, 2, 'down'), note('G', 1, 2, 'down'));
    const svg = render(xml);
    const x = [...svg.matchAll(/<g transform="translate\(([^ ]+) ([^)]+)\)"[^>]*><text[^>]*>&#57508;<\/text>/g)].map(
        m => Number(m[1])
    );
    expect(x.length).toBeGreaterThan(0);
    expect(new Set(x).size).toBe(1);
});
