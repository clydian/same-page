import { MusicXmlImporter } from '@coderline/alphatab/importer/MusicXmlImporter';
import { ByteBuffer } from '@coderline/alphatab/io/ByteBuffer';
import { JsonConverter } from '@coderline/alphatab/model/JsonConverter';
import { ScoreRenderer } from '@coderline/alphatab/rendering/ScoreRenderer';
import { ScoreTieGlyph } from '@coderline/alphatab/rendering/glyphs/ScoreTieGlyph';
import { ScoreSlurGlyph } from '@coderline/alphatab/rendering/glyphs/ScoreSlurGlyph';
import { BeatXPosition } from '@coderline/alphatab/rendering/BeatXPosition';
import { TieGlyph } from '@coderline/alphatab/rendering/glyphs/TieGlyph';
import { Settings } from '@coderline/alphatab/Settings';
import { LayoutMode } from '@coderline/alphatab/LayoutMode';
import { describe, expect, it, vi } from 'vitest';
function source(startStaff = 2, endStaff = 1, startVoice = 1, endVoice = 1) {
    const n = (staff: number, voice: number, type: string) =>
        `<note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><voice>${voice}</voice><type>half</type><staff>${staff}</staff><notations><slur type="${type}" number="1" placement="above"/></notations></note>`;
    return `<score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>${n(startStaff, startVoice, 'start')}${n(endStaff, endVoice, 'stop')}</measure></part></score-partwise>`;
}
function load(xml: string) {
    const importer = new MusicXmlImporter();
    importer.init(ByteBuffer.fromBuffer(new TextEncoder().encode(xml)), new Settings());
    return importer.readScore();
}
function origins(xml: string) {
    return load(xml)
        .tracks.flatMap(t =>
            t.staves.flatMap(s => s.bars.flatMap(b => b.voices.flatMap(v => v.beats.flatMap(b => b.notes))))
        )
        .filter(n => n.isSlurOrigin);
}
describe('MusicXML cross-staff phrase slurs', () => {
    it.each([
        [2, 1],
        [1, 2]
    ])('connects numbered same-voice slur staff %i to %i', (a, b) => {
        const o = origins(source(a, b));
        expect(o).toHaveLength(1);
        expect(o[0].slurDestination?.beat.voice.bar.staff.index).toBe(b - 1);
    });
    it('retains same-staff legacy lookup', () => {
        expect(origins(source(1, 1))).toHaveLength(1);
    });
    it('uses the explicit number across voices rather than assuming voice identity', () => {
        expect(origins(source(2, 1, 1, 2))).toHaveLength(1);
    });
    it('does not connect a different numbered stop', () => {
        expect(origins(source().replace('type="stop" number="1"', 'type="stop" number="2"'))).toHaveLength(0);
    });
    it('does not match an origin in another part', () => {
        const second = source()
            .replaceAll('P1', 'P2')
            .match(/<part id="P2">[\s\S]*<\/part>/)![0]
            .replace('<slur type="start" number="1" placement="above"/>', '');
        const first = source()
            .replace('<slur type="stop" number="1" placement="above"/>', '')
            .replace('</part-list>', '<score-part id="P2"><part-name>Piano2</part-name></score-part></part-list>')
            .replace('</score-partwise>', `${second}</score-partwise>`);
        expect(origins(first)).toHaveLength(0);
    });
    it('rejects an ambiguous cross-staff fallback instead of choosing a staff', () => {
        const extra =
            '<backup><duration>2</duration></backup><note><pitch><step>E</step><octave>4</octave></pitch><duration>2</duration><voice>2</voice><type>half</type><staff>3</staff><notations><slur type="start" number="1"/></notations></note>';
        const xml = source()
            .replace('<staves>2</staves>', '<staves>3</staves>')
            .replace(
                /<note><pitch><step>C<\/step><octave>4<\/octave><\/pitch><duration>2<\/duration><voice>1<\/voice><type>half<\/type><staff>1<\/staff>/,
                extra +
                    '<note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>half</type><staff>1</staff>'
            );
        expect(origins(xml)).toHaveLength(0);
    });
    it('draws one continuous cross-staff segment, not two system-break halves', () => {
        const settings = new Settings();
        settings.core.engine = 'svg';
        const score = load(source()),
            renderer = new ScoreRenderer(settings);
        renderer.width = 900;
        const segments = new Map<ScoreSlurGlyph, { y1: number; y2: number }>();
        const original = ScoreSlurGlyph.prototype.doLayout;
        const spy = vi.spyOn(ScoreSlurGlyph.prototype, 'doLayout').mockImplementation(function (this: ScoreSlurGlyph) {
            original.call(this);
            if (Reflect.get(this, '_shouldPaint')) {
                segments.set(this, { y1: Reflect.get(this, '_startY'), y2: Reflect.get(this, '_endY') });
            } else {
                segments.delete(this);
            }
        });
        renderer.error.on(error => {
            throw error;
        });
        try {
            renderer.renderScore(score, [0]);
        } finally {
            spy.mockRestore();
            renderer.destroy();
        }
        expect(segments.size).toBe(1);
        const first = [...segments.values()][0];
        expect(first.y1).not.toBe(first.y2);
    });
    it('does not count a second staff as extra vertical overflow', () => {
        const dimensions = (xml: string) => {
            const settings = new Settings();
            settings.core.engine = 'svg';
            settings.core.enableLazyLoading = false;
            const renderer = new ScoreRenderer(settings);
            renderer.width = 900;
            const values: number[][] = [];
            renderer.partialRenderFinished.on(event => {
                if (typeof event.renderResult === 'string') {
                    values.push([event.width, event.height]);
                }
            });
            renderer.error.on(error => {
                throw error;
            });
            try {
                renderer.renderScore(load(xml), [0]);
            } finally {
                renderer.destroy();
            }
            return values;
        };
        expect(dimensions(source())).toEqual(dimensions(source().replace(/<notations>.*?<\/notations>/g, '')));
    });
    it.each(['above', 'below'])('keeps the actual painted outer %s curve within the SVG', placement => {
        const xml = source(placement === 'above' ? 1 : 2, placement === 'above' ? 2 : 1)
            .replaceAll('placement="above"', `placement="${placement}"`)
            .replaceAll('<octave>4</octave>', placement === 'above' ? '<octave>7</octave>' : '<octave>1</octave>');
        const settings = new Settings();
        settings.core.engine = 'svg';
        settings.core.enableLazyLoading = false;
        const renderer = new ScoreRenderer(settings);
        renderer.width = 900;
        const bounds: { x: number; y: number; w: number; h: number }[] = [],
            sizes: number[][] = [];
        const original = TieGlyph.paintTie;
        const spy = vi
            .spyOn(TieGlyph, 'paintTie')
            .mockImplementation((canvas, scale, x1, y1, x2, y2, down, offset, size) => {
                bounds.push(TieGlyph.calculateActualTieHeight(scale, x1, y1, x2, y2, down, offset, size));
                original(canvas, scale, x1, y1, x2, y2, down, offset, size);
            });
        renderer.partialRenderFinished.on(event => {
            if (typeof event.renderResult === 'string') {
                sizes.push([event.width, event.height]);
            }
        });
        renderer.error.on(error => {
            throw error;
        });
        try {
            renderer.renderScore(load(xml), [0]);
        } finally {
            spy.mockRestore();
            renderer.destroy();
        }
        expect(bounds).toHaveLength(1);
        const ink = bounds[0],
            width = Math.max(...sizes.map(s => s[0])),
            height = Math.max(...sizes.map(s => s[1]));
        expect(ink.x).toBeGreaterThanOrEqual(0);
        expect(ink.y).toBeGreaterThanOrEqual(0);
        expect(ink.x + ink.w).toBeLessThanOrEqual(width);
        expect(ink.y + ink.h).toBeLessThanOrEqual(height);
    });
    it('leaves the legacy cross-staff pitch-tie segment rule unchanged', () => {
        const score = load(source().replace(/<notations>.*?<\/notations>/g, ''));
        const notes = score.tracks[0].staves.flatMap(staff =>
            staff.bars[0].voices.flatMap(voice => voice.beats.flatMap(beat => beat.notes))
        );
        const origin = notes.find(note => note.beat.playbackStart === 0)!;
        const destination = notes.find(note => note.beat.playbackStart > 0)!;
        origin.tieDestination = destination;
        destination.tieOrigin = origin;
        destination.isTieDestination = true;
        const settings = new Settings();
        settings.core.engine = 'svg';
        settings.core.enableLazyLoading = false;
        const renderer = new ScoreRenderer(settings);
        renderer.width = 900;
        let painted = 0;
        const original = ScoreTieGlyph.prototype.paint;
        const spy = vi.spyOn(ScoreTieGlyph.prototype, 'paint').mockImplementation(function (
            this: ScoreTieGlyph,
            cx,
            cy,
            canvas
        ) {
            original.call(this, cx, cy, canvas);
            if (Reflect.get(this, '_shouldPaint')) {
                painted++;
            }
        });
        renderer.error.on(error => {
            throw error;
        });
        try {
            renderer.renderScore(score, [0]);
        } finally {
            spy.mockRestore();
            renderer.destroy();
        }
        expect(painted).toBe(2);
    });
    it('keeps a cross-staff phrase connected across bars and system breaks', () => {
        const xml = source()
            .replace('<beats>4</beats>', '<beats>2</beats>')
            .replace('</note><note>', '</note></measure><measure number="2"><print new-system="yes"/><note>');
        const score = load(xml);
        expect(origins(xml)).toHaveLength(1);
        const settings = new Settings();
        settings.core.engine = 'svg';
        settings.display.barsPerRow = 1;
        settings.core.enableLazyLoading = false;
        const renderer = new ScoreRenderer(settings);
        renderer.width = 900;
        const painted: { system: number; forEnd: boolean; x1: number; x2: number; expectedNoteX: number }[] = [];
        const original = ScoreSlurGlyph.prototype.paint;
        const spy = vi.spyOn(ScoreSlurGlyph.prototype, 'paint').mockImplementation(function (
            this: ScoreSlurGlyph,
            cx,
            cy,
            canvas
        ) {
            original.call(this, cx, cy, canvas);
            if (Reflect.get(this, '_shouldPaint')) {
                const forEnd = Reflect.get(this, 'isForEnd');
                const note = Reflect.get(this, forEnd ? 'endNote' : 'startNote');
                painted.push({
                    system: this.renderer.staff!.system.index,
                    forEnd,
                    x1: Reflect.get(this, '_startX'),
                    x2: Reflect.get(this, '_endX'),
                    expectedNoteX:
                        this.renderer.x +
                        this.renderer.getBeatX(note.beat, forEnd ? BeatXPosition.Stem : BeatXPosition.MiddleNotes)
                });
            }
        });
        renderer.error.on(error => {
            throw error;
        });
        try {
            renderer.renderScore(score, [0]);
        } finally {
            spy.mockRestore();
            renderer.destroy();
        }
        expect(painted).toHaveLength(2);
        expect(painted.map(segment => [segment.system, segment.forEnd])).toEqual([
            [0, false],
            [1, true]
        ]);
        expect(painted.every(segment => segment.x2 > segment.x1)).toBe(true);
        expect(painted[0].x1).toBeCloseTo(painted[0].expectedNoteX);
        expect(painted[1].x2).toBeCloseTo(painted[1].expectedNoteX);
    });
    it.each([
        LayoutMode.Page,
        LayoutMode.Horizontal
    ])('renders the connected span after public Worker JSON in layout %i', layout => {
        const settings = new Settings();
        settings.core.engine = 'svg';
        settings.display.layoutMode = layout;
        const score = JsonConverter.jsObjectToScore(JsonConverter.scoreToJsObject(load(source()))),
            renderer = new ScoreRenderer(settings);
        renderer.width = 900;
        let count = 0;
        const original = ScoreSlurGlyph.prototype.doLayout;
        const spy = vi.spyOn(ScoreSlurGlyph.prototype, 'doLayout').mockImplementation(function (this: ScoreSlurGlyph) {
            original.call(this);
            count++;
        });
        renderer.error.on(e => {
            throw e;
        });
        try {
            renderer.renderScore(score, [0]);
        } finally {
            spy.mockRestore();
            renderer.destroy();
        }
        expect(count).toBeGreaterThan(0);
    });
});
