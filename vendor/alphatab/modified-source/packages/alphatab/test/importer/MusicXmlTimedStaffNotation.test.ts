import { MusicXmlImporter } from '@coderline/alphatab/importer/MusicXmlImporter';
import { ByteBuffer } from '@coderline/alphatab/io/ByteBuffer';
import { AlphaSynthMidiFileHandler } from '@coderline/alphatab/midi/AlphaSynthMidiFileHandler';
import { MidiFile } from '@coderline/alphatab/midi/MidiFile';
import { MidiFileGenerator } from '@coderline/alphatab/midi/MidiFileGenerator';
import { Clef } from '@coderline/alphatab/model/Clef';
import { JsonConverter } from '@coderline/alphatab/model/JsonConverter';
import { ModelUtils } from '@coderline/alphatab/model/ModelUtils';
import { AccidentalHelper } from '@coderline/alphatab/rendering/utils/AccidentalHelper';
import { LayoutMode } from '@coderline/alphatab/LayoutMode';
import { ScoreRenderer } from '@coderline/alphatab/rendering/ScoreRenderer';
import { StaveProfile } from '@coderline/alphatab/StaveProfile';
import { Settings } from '@coderline/alphatab/Settings';
import { describe, expect, it } from 'vitest';

const bass = '<clef><sign>F</sign><line>4</line></clef>';
const treble = '<clef><sign>G</sign><line>2</line></clef>';
const note = (step: string, octave: number, duration: number, type: string) =>
    `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>${duration}</duration><type>${type}</type></note>`;
function load(measures: string) {
    const source = `<score-partwise version="4.0"><part-list><score-part id="P"><part-name>Piano</part-name></score-part></part-list><part id="P">${measures}</part></score-partwise>`;
    const importer = new MusicXmlImporter();
    importer.init(ByteBuffer.fromBuffer(new TextEncoder().encode(source)), new Settings());
    return JsonConverter.jsObjectToScore(JsonConverter.scoreToJsObject(importer.readScore()));
}
const initial = `<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time>${bass}</attributes>`;

function renderNotationScore(score: ReturnType<typeof load>, layout: LayoutMode) {
    const settings = new Settings();
    settings.core.engine = 'svg';
    settings.core.enableLazyLoading = false;
    settings.display.staveProfile = StaveProfile.Score;
    settings.display.layoutMode = layout;
    const renderer = new ScoreRenderer(settings);
    renderer.width = 1000;
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
    return pieces
        .join('')
        .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(Number.parseInt(h, 16)))
        .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

describe('MusicXML staff notation follows musical time rather than attribute document order', () => {
    for (const layout of [LayoutMode.Page, LayoutMode.Horizontal]) {
        it(`does not redraw unchanged visible fifths for a mode-only timed key in layout ${layout}`, () => {
            const attrs = initial.replace(
                '</attributes>',
                '<key><fifths>2</fifths><mode>major</mode></key></attributes>'
            );
            const score = load(
                `<measure number="1">${attrs}${note('A', 3, 1, 'quarter')}<attributes><key><fifths>2</fifths><mode>minor</mode></key></attributes>${note('A', 3, 1, 'quarter')}<attributes><key><fifths>2</fifths><mode>dorian</mode></key></attributes>${note('A', 3, 2, 'half')}</measure>`
            );
            const bar = score.tracks[0].staves[0].bars[0];
            expect(bar.notationChanges).toHaveLength(2);
            expect(bar.getKeySignatureTypeAt(960)).toBe(1);
            expect(bar.getKeySignatureTypeAt(1920)).toBe(0);
            expect((renderNotationScore(score, layout).match(/\uE262/g) ?? []).length).toBe(2);
        });
    }
    it('preserves explicit cancellation and a return from hidden to visible key printing', () => {
        const attrs = initial.replace('</attributes>', '<key><fifths>2</fifths></key></attributes>');
        const cases = [
            { changes: '<attributes><key><cancel>2</cancel><fifths>2</fifths></key></attributes>', count: 4 },
            {
                changes:
                    '<attributes><key print-object="no"><fifths>2</fifths></key></attributes><attributes><key><fifths>2</fifths></key></attributes>',
                count: 4
            }
        ];
        for (const { changes, count } of cases) {
            const score = load(
                `<measure number="1">${attrs}${note('A', 3, 1, 'quarter')}${changes}${note('A', 3, 3, 'half')}</measure>`
            );
            expect((renderNotationScore(score, LayoutMode.Page).match(/\uE262/g) ?? []).length).toBe(count);
        }
    });
    it('keeps the old clef for a completed bar and carries its end change to the next bar', () => {
        const score = load(`<measure number="1">${initial}${note('G', 2, 4, 'whole')}<attributes>${treble}</attributes></measure><measure number="2">${note('G', 4, 4, 'whole')}<attributes>${bass}</attributes></measure><measure number="3">${note('G', 2, 4, 'whole')}</measure>`);
        expect(score.tracks[0].staves[0].bars.map(b => b.clef)).toEqual([Clef.F4, Clef.G2, Clef.F4]);
    });
    it('uses the changed clef only for notes at or after its in-bar musical time', () => {
        const score = load(`<measure number="1">${initial}${note('G', 2, 1, 'quarter')}<attributes>${treble}</attributes>${note('G', 4, 1, 'quarter')}<attributes>${bass}</attributes>${note('G', 2, 2, 'half')}</measure>`);
        const bar = score.tracks[0].staves[0].bars[0];
        const expectedClefs = [Clef.F4, Clef.G2, Clef.F4];
        for (const [index, beat] of bar.voices[0].beats.entries()) {
            const n = beat.notes[0];
            const spelling = ModelUtils.resolveSpelling(bar.keySignature, n.displayValue, n.accidentalMode);
            expect(AccidentalHelper.computeStepsWithoutAccidentals(bar, n)).toBe(AccidentalHelper.calculateNoteSteps(expectedClefs[index], spelling));
        }
    });
    for (const layout of [LayoutMode.Page, LayoutMode.Horizontal]) {
        it(`draws both real in-bar changes within a single bar in layout ${layout}`, () => {
            const score = load(`<measure number="1">${initial}${note('G', 2, 1, 'quarter')}<attributes>${treble}</attributes>${note('G', 4, 1, 'quarter')}<attributes>${bass}</attributes>${note('G', 2, 2, 'half')}</measure>`);
            const settings = new Settings();
            settings.core.engine = 'svg'; settings.core.enableLazyLoading = false;
            settings.display.staveProfile = StaveProfile.Score; settings.display.layoutMode = layout;
            const renderer = new ScoreRenderer(settings); renderer.width = 1000;
            const pieces: string[] = [];
            renderer.partialRenderFinished.on(event => { if (typeof event.renderResult === 'string') { pieces.push(event.renderResult);  }});
            renderer.error.on(error => { throw error; });
            try { renderer.renderScore(score, [0]); } finally { renderer.destroy(); }
            const svg = pieces.join('').replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(Number.parseInt(h, 16))).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
            expect((svg.match(/\uE050/g) ?? []).length).toBe(1);
            expect((svg.match(/\uE062/g) ?? []).length).toBe(2);
        });
    }
    for (const [label, change, expectedSharps] of [
        ['clef', treble, 1], ['key', '<key><fifths>1</fifths></key>', 3]
    ] as const) {
        it(`keeps accidentals in pitch scope across ${label} changes`, () => {
            const altered = (duration: number, type: string) => note('G', 3, duration, type).replace('</step>', '</step><alter>1</alter>');
            const score = load(`<measure number="1">${initial}${altered(1, 'quarter')}<attributes>${change}</attributes>${altered(1, 'quarter')}${altered(2, 'half')}</measure>`);
            const settings = new Settings(); settings.core.engine = 'svg'; settings.core.enableLazyLoading = false; settings.display.staveProfile = StaveProfile.Score;
            const renderer = new ScoreRenderer(settings); renderer.width = 1000; const pieces: string[] = [];
            renderer.partialRenderFinished.on(event => {if (typeof event.renderResult === 'string') { pieces.push(event.renderResult); }});
            renderer.error.on(error => {throw error;});
            try {renderer.renderScore(score, [0]);} finally {renderer.destroy();}
            const svg = pieces.join('').replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(Number.parseInt(h, 16))).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
            expect((svg.match(/\uE262/g) ?? []).length).toBe(expectedSharps);
        });
    }
    it('keeps numbered staff changes independent after backup and divisions changes', () => {
        const staffNote = (step: string, octave: number, duration: number, type: string, staff: number) => note(step, octave, duration, type).replace('</type>', `</type><staff>${staff}</staff>`);
        const score = load(`<measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>${staffNote('C', 5, 4, 'whole', 1)}<backup><duration>4</duration></backup>${staffNote('G', 2, 1, 'quarter', 2)}<attributes><divisions>2</divisions><clef number="2"><sign>G</sign><line>2</line></clef></attributes>${staffNote('G', 4, 2, 'quarter', 2)}<attributes><clef number="2"><sign>F</sign><line>4</line></clef></attributes>${staffNote('G', 2, 4, 'half', 2)}</measure><measure number="2">${staffNote('G', 2, 8, 'whole', 2)}</measure>`);
        expect(score.tracks[0].staves[0].bars[0].notationChanges).toBeNull();
        const lower = score.tracks[0].staves[1];
        expect(lower.bars[0].notationChanges?.map(c => [c.displayStart, c.clef])).toEqual([[960, Clef.G2], [1920, Clef.F4]]);
        expect(lower.bars[1].clef).toBe(Clef.F4);
        expect(lower.bars[0].voices[0].beats.map(b => b.displayStart)).toEqual([0, 960, 1920]);
    });
    it('uses score-time zero after backup rather than the last parsed voice', () => {
        const score = load(`<measure number="1">${initial}${note('G', 2, 4, 'whole')}<backup><duration>4</duration></backup><attributes>${treble}</attributes>${note('G', 4, 4, 'whole').replace('</duration>', '</duration><voice>2</voice>')}</measure>`);
        expect(score.tracks[0].staves[0].bars[0].clef).toBe(Clef.G2);
        expect(score.tracks[0].staves[0].bars[0].notationChanges).toBeNull();
    });
    it('preserves every MIDI field and bar bound without inserting notation beats', () => {
        const changes = `<measure number="1">${initial}${note('G', 2, 1, 'quarter')}<attributes>${treble}</attributes>${note('G', 4, 1, 'quarter')}<attributes>${bass}</attributes>${note('G', 2, 2, 'half')}</measure>`;
        const controls = changes.replaceAll(`<attributes>${treble}</attributes>`, '').replaceAll(`<attributes>${bass}</attributes>`, '');
        const midi = (xml: string) => {
            const score = load(xml); const settings = new Settings(); const file = new MidiFile();
            const generator = new MidiFileGenerator(score, settings, new AlphaSynthMidiFileHandler(file));
            generator.applyTranspositionPitches = false; generator.generate();
            return { events: JSON.parse(JSON.stringify(file.tracks.flatMap(track => track.events))), bounds: generator.tickLookup.masterBars.map(bar => [bar.start, bar.end]), beats: score.tracks[0].staves[0].bars[0].voices[0].beats.length };
        };
        expect(midi(changes)).toEqual(midi(controls));
        expect(midi(changes).beats).toBe(3);
    });
    it('keeps hidden changes semantic while suppressing only their clef glyph', () => {
        const score = load(`<measure number="1">${initial}${note('G', 2, 1, 'quarter')}<attributes>${treble.replace('<clef>', '<clef print-object="no">')}</attributes>${note('G', 4, 3, 'half')}</measure>`);
        const bar = score.tracks[0].staves[0].bars[0];
        expect(bar.getClefAt(960)).toBe(Clef.G2);
        expect(bar.notationChanges?.[0].isClefVisible).toBe(false);
    });
    it('applies an unnumbered timed key to a declared second staff before its notes are parsed', () => {
        const staffNote = (staff: number) => note('C', 4, 4, 'whole').replace('</type>', `</type><staff>${staff}</staff>`);
        const score = load(`<measure number="1">${initial}<attributes><staves>2</staves></attributes>${staffNote(1)}<attributes><key><fifths>-4</fifths></key></attributes><backup><duration>4</duration></backup>${staffNote(2)}</measure><measure number="2">${staffNote(1)}<backup><duration>4</duration></backup>${staffNote(2)}</measure>`);
        expect(score.tracks[0].staves.map(staff => staff.bars[0].notationChanges?.map(c => [c.displayStart, c.keySignature]))).toEqual([[[3840, -4]], [[3840, -4]]]);
        expect(score.tracks[0].staves.map(staff => staff.bars[1].keySignature)).toEqual([-4, -4]);
    });
    it('keeps legacy JSON without notation changes on the original null path', () => {
        const score = load(`<measure number="1">${initial}${note('G', 2, 4, 'whole')}</measure>`);
        expect(score.tracks[0].staves[0].bars[0].notationChanges).toBeNull();
    });
    it('keeps a clef change inside a held note at its own exact display time without a new beat', () => {
        const score = load(`<measure number="1">${initial}${note('G', 2, 4, 'whole')}<backup><duration>3</duration></backup><attributes>${treble}</attributes></measure>`);
        const bar = score.tracks[0].staves[0].bars[0];
        expect(bar.notationChanges?.[0].displayStart).toBe(960);
        expect(bar.voices[0].beats.length).toBe(1);
        const settings = new Settings(); settings.core.engine = 'svg'; settings.core.enableLazyLoading = false; settings.display.staveProfile = StaveProfile.Score;
        const renderer = new ScoreRenderer(settings); renderer.width = 1000; const pieces: string[] = [];
        renderer.partialRenderFinished.on(event => { if (typeof event.renderResult === 'string') { pieces.push(event.renderResult); } });
        renderer.error.on(error => { throw error; });
        try { renderer.renderScore(score, [0]); } finally { renderer.destroy(); }
        const svg = pieces.join('').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
        expect((svg.match(/\uE050/g) ?? []).length).toBe(1);
        expect(svg.includes('NaN')).toBe(false);
    });
    for (const extra of ['', `<forward><duration>1</duration></forward><attributes>${bass}</attributes>`]) {
    it(`keeps positive native geometry for a change inside a held whole note (${extra ? 'two' : 'one'} changes)`, () => {
        const score = load(`<measure number="1">${initial}${note('G', 2, 4, 'whole')}<backup><duration>3</duration></backup><attributes>${treble}</attributes>${extra}</measure>`);
        const bar = score.tracks[0].staves[0].bars[0];
        const settings = new Settings(); settings.core.engine = 'svg'; settings.core.enableLazyLoading = false; settings.display.staveProfile = StaveProfile.Score;
        const renderer = new ScoreRenderer(settings); renderer.width = 1000;
        renderer.error.on(error => { throw error; });
        try {
            renderer.renderScore(score, [0]);
            const layout = renderer.layout!.getRendererForBar('score', bar)!;
            const info = layout.layoutingInfo;
            for (const spring of info.springs.values()) { expect(spring.springConstant).toBeGreaterThan(0); }
            expect(info.totalSpringConstant).toBeGreaterThan(0);
            expect(info.minStretchForce).toBeGreaterThan(0);
            const x1 = layout.getDisplayTimeX(960), x2 = layout.getDisplayTimeX(extra ? 1920 : 960);
            expect(x1 - info.springs.get(960)!.preSpringWidth).toBeGreaterThan(layout.getDisplayTimeX(0));
            if (extra) { expect(x2).toBeGreaterThan(x1); }
            expect(x2).toBeLessThan(layout.width);
        } finally { renderer.destroy(); }
    });
    }
    it('draws an end clef before the final barline rather than through it', () => {
        const score = load(`<measure number="1">${initial}${note('G', 2, 4, 'whole')}<attributes>${treble}</attributes><barline location="right"><bar-style>light-heavy</bar-style></barline></measure>`);
        const settings = new Settings(); settings.core.engine = 'svg'; settings.core.enableLazyLoading = false; settings.display.staveProfile = StaveProfile.Score;
        const renderer = new ScoreRenderer(settings); renderer.width = 1000; const pieces: string[] = [];
        renderer.partialRenderFinished.on(event => { if (typeof event.renderResult === 'string') { pieces.push(event.renderResult); } });
        renderer.error.on(error => { throw error; });
        try { renderer.renderScore(score, [0]); } finally { renderer.destroy(); }
        const svg = pieces.join('').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
        const clef = [...svg.matchAll(/<g transform="translate\(([-.\d]+) [^)]*\)" class="at"[^>]*><text[^>]*>\uE050<\/text>/g)];
        expect(clef).toHaveLength(1);
        const barlineXs = [...svg.matchAll(/<rect x="([-.\d]+)" y="[-.\d]+" width="([-.\d]+)" height="([-.\d]+)"/g)].filter(m => Number(m[2]) < 10 && Number(m[3]) > 30).map(m => Number(m[1]));
        expect(barlineXs.length).toBeGreaterThan(0);
        expect(Math.max(...barlineXs)).toBeGreaterThan(Number(clef[0][1]));
    });
    for (const [style, repeat, extended] of [['regular', '', true], ['light-heavy', '', false], ['light-heavy', '<repeat direction="backward" times="3"/>', true]] as const) {
    it(`aligns ${style} end barlines across staves (repeat=${!!repeat}, extended=${extended})`, () => {
        const lower = note('G', 2, 4, 'whole').replace('</type>', '</type><staff>2</staff>');
        const score = load(`<measure number="1">${initial}<attributes><staves>2</staves><clef number="2"><sign>F</sign><line>4</line></clef></attributes>${note('G', 2, 4, 'whole')}<attributes>${treble}</attributes><backup><duration>4</duration></backup>${lower}<barline location="right"><bar-style>${style}</bar-style>${repeat}</barline></measure>`);
        const settings = new Settings(); settings.core.engine = 'svg'; settings.core.enableLazyLoading = false; settings.display.staveProfile = StaveProfile.Score;
        score.stylesheet.extendBarLines = extended;
        const renderer = new ScoreRenderer(settings); renderer.width = 1000; const pieces: string[] = [];
        renderer.partialRenderFinished.on(event => { if (typeof event.renderResult === 'string') { pieces.push(event.renderResult); } });
        renderer.error.on(error => { throw error; });
        try { renderer.renderScore(score, [0]); } finally { renderer.destroy(); }
        const rects = [...pieces.join('').matchAll(/<rect x="([-.\d]+)" y="[-.\d]+" width="([-.\d]+)" height="([-.\d]+)"/g)].filter(m => Number(m[2]) < 10 && Number(m[3]) > 30 && Number(m[1]) > 100);
        expect(rects.length).toBeGreaterThanOrEqual(2);
        const lineCounts = new Map<string, number>();
        for (const rect of rects) { const key = Number(rect[1]).toFixed(6); lineCounts.set(key, (lineCounts.get(key) ?? 0) + 1); }
        for (const count of lineCounts.values()) { expect(count).toBe(2); }
    });
    }
    for (const unsupported of [
        '<clef><sign>percussion</sign></clef>',
        '<clef><sign>TAB</sign></clef>',
        '<clef><sign>G</sign><line>1</line></clef>',
        '<clef additional="yes"><sign>G</sign><line>2</line></clef>'
    ]) {
        it(`conservatively ignores unsupported timed clefs: ${unsupported}`, () => {
            const score = load(`<measure number="1">${initial}${note('G', 2, 1, 'quarter')}<attributes>${unsupported}</attributes>${note('G', 2, 3, 'half')}</measure>`);
            expect(score.tracks[0].staves[0].bars[0].notationChanges).toBeNull();
            expect(score.tracks[0].staves[0].isPercussion).toBe(false);
        });
    }
    for (const invalid of ['', '1foo', '1.5']) {
        it(`does not invent a timed key for invalid fifths ${JSON.stringify(invalid)}`, () => {
            const score = load(`<measure number="1">${initial}${note('G', 2, 1, 'quarter')}<attributes><key><fifths>${invalid}</fifths></key></attributes>${note('G', 2, 3, 'half')}</measure>`);
            expect(score.tracks[0].staves[0].bars[0].notationChanges).toBeNull();
        });
    }
    it('retains a real end-key change without changing the previous bar initial signature', () => {
        const score = load(`<measure number="1">${initial}<attributes><key><fifths>1</fifths></key></attributes>${note('G', 2, 4, 'whole')}<attributes><key><fifths>-4</fifths></key></attributes></measure><measure number="2">${note('G', 2, 4, 'whole')}</measure>`);
        expect(score.tracks[0].staves[0].bars.map(b => b.keySignature)).toEqual([1, -4]);
    });
});
