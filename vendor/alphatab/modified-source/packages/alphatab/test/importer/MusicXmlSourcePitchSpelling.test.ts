import { MusicXmlImporter } from '@coderline/alphatab/importer/MusicXmlImporter';
import { ByteBuffer } from '@coderline/alphatab/io/ByteBuffer';
import { LayoutMode } from '@coderline/alphatab/LayoutMode';
import { JsonConverter } from '@coderline/alphatab/model/JsonConverter';
import { ModelUtils } from '@coderline/alphatab/model/ModelUtils';
import { ScoreRenderer } from '@coderline/alphatab/rendering/ScoreRenderer';
import { Settings } from '@coderline/alphatab/Settings';
import { StaveProfile } from '@coderline/alphatab/StaveProfile';
import { describe, expect, it } from 'vitest';

function load(step: string, alter: number, octave: number) {
    const xml = `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>1</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>F</sign><line>4</line></clef></attributes><note><pitch><step>${step}</step><alter>${alter}</alter><octave>${octave}</octave></pitch><duration>4</duration><type>whole</type></note></measure></part></score-partwise>`;
    return loadXml(xml);
}
function loadXml(xml: string, settings = new Settings()) {
    const importer = new MusicXmlImporter();
    importer.init(ByteBuffer.fromBuffer(new TextEncoder().encode(xml)), settings);
    return JsonConverter.jsObjectToScore(JsonConverter.scoreToJsObject(importer.readScore()));
}

describe('MusicXML source pitch spelling without an explicit accidental glyph', () => {
    for (const [step, alter, octave, degree, midi] of [
        ['B', -1, 2, 6, 46],
        ['E', -1, 2, 2, 39],
        ['F', 0, 4, 3, 65],
        ['B', 1, 3, 6, 60],
        ['C', -1, 4, 0, 59],
        ['C', 2, 4, 0, 62],
        ['E', -2, 4, 2, 62]
    ] as const) {
        it(`retains ${step}${alter} in octave ${octave} through Worker JSON`, () => {
            const score = load(step, alter, octave);
            const bar = score.tracks[0].staves[0].bars[0];
            const note = bar.voices[0].beats[0].notes[0];
            expect(note.realValue).toBe(midi);
            const spelling = ModelUtils.resolveSpelling(bar.keySignature, note.displayValue, note.accidentalMode);
            expect([spelling.degree, spelling.accidentalOffset, spelling.octave]).toEqual([degree, alter, octave]);
        });
    }
    for (const layout of [LayoutMode.Page, LayoutMode.Horizontal]) {
        it(`does not draw an A sharp or repeat a carried B flat in layout ${layout}`, () => {
            const notes = [
                ['E', -1, 2, true],
                ['B', -1, 2, true],
                ['G', 0, 3, false],
                ['B', -1, 2, false],
                ['B', -1, 3, true]
            ]
                .map(
                    ([step, alter, octave, explicit], i) =>
                        `<note><pitch><step>${step}</step><alter>${alter}</alter><octave>${octave}</octave></pitch><duration>${i === 4 ? 2 : 1}</duration><type>${i === 4 ? 'quarter' : 'eighth'}</type>${explicit ? '<accidental>flat</accidental>' : ''}</note>`
                )
                .join('');
            const xml = `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>2</divisions><key><fifths>1</fifths></key><time><beats>3</beats><beat-type>4</beat-type></time><clef><sign>F</sign><line>4</line></clef></attributes>${notes}</measure></part></score-partwise>`;
            const settings = new Settings();
            settings.core.engine = 'svg';
            settings.core.enableLazyLoading = false;
            settings.display.staveProfile = StaveProfile.Score;
            settings.display.layoutMode = layout;
            const score = loadXml(xml, settings);
            expect(score.tracks[0].staves[0].bars[0].voices[0].beats.map(b => b.notes[0].realValue)).toEqual([
                39, 46, 55, 46, 58
            ]);
            const renderer = new ScoreRenderer(settings);
            renderer.width = 1200;
            const pieces: string[] = [];
            renderer.partialRenderFinished.on(event => {
                if (typeof event.renderResult === 'string') {
                    pieces.push(event.renderResult);
                }
            });
            renderer.error.on(error => {
                throw error;
            });
            try {
                renderer.renderScore(score, [0]);
            } finally {
                renderer.destroy();
            }
            const svg = pieces
                .join('')
                .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
                .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
            expect(pieces.length).toBeGreaterThan(0);
            expect((svg.match(/\uE262/g) ?? []).length).toBe(1); // key signature F sharp only
            expect((svg.match(/\uE260/g) ?? []).length).toBe(3); // E flat, B flat, octave B flat
        });
    }
});
