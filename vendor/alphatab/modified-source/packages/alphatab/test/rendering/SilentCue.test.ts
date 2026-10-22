import {
    AlphaSkiaCanvas,
    AlphaSkiaTextAlign,
    AlphaSkiaTextBaseline,
    AlphaSkiaTextStyle,
    AlphaSkiaTypeface
} from '@coderline/alphaskia';
import { MusicXmlImporter } from '@coderline/alphatab/importer/MusicXmlImporter';
import { ByteBuffer } from '@coderline/alphatab/io/ByteBuffer';
import { LayoutMode } from '@coderline/alphatab/LayoutMode';
import { AlphaSynthMidiFileHandler } from '@coderline/alphatab/midi/AlphaSynthMidiFileHandler';
import { NoteEvent } from '@coderline/alphatab/midi/MidiEvent';
import { MidiFile } from '@coderline/alphatab/midi/MidiFile';
import { MidiFileGenerator } from '@coderline/alphatab/midi/MidiFileGenerator';
import { JsonConverter } from '@coderline/alphatab/model/JsonConverter';
import { MusicFontSymbol } from '@coderline/alphatab/model/MusicFontSymbol';
import { ScoreRenderer } from '@coderline/alphatab/rendering/ScoreRenderer';
import { Settings } from '@coderline/alphatab/Settings';
import { StaveProfile } from '@coderline/alphatab/StaveProfile';
import { AlphaSynth } from '@coderline/alphatab/synth/AlphaSynth';
import { TestOutput } from 'test/audio/TestOutput';
import { TestPlatform } from 'test/TestPlatform';
import { describe, expect, it } from 'vitest';

function load(kind = 'cue', size = '') {
    const xml = `<score-partwise version="4.0"><part-list><score-part id="P"><part-name>Piano</part-name></score-part></part-list><part id="P"><measure number="1"><attributes><divisions>1</divisions><time><beats>2</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><note>${kind === 'cue' ? '<cue/>' : ''}${kind === 'rest' ? '<rest/>' : '<pitch><step>C</step><octave>5</octave></pitch>'}<duration>1</duration><type${size ? ` size="${size}"` : ''}>quarter</type></note><note><pitch><step>D</step><octave>5</octave></pitch><duration>1</duration><type>quarter</type></note></measure></part></score-partwise>`;
    const settings = new Settings();
    settings.core.engine = 'svg';
    settings.core.enableLazyLoading = false;
    settings.display.staveProfile = StaveProfile.Score;
    const importer = new MusicXmlImporter();
    importer.init(ByteBuffer.fromBuffer(new TextEncoder().encode(xml)), settings);
    return { score: importer.readScore(), settings };
}
function events(kind = 'cue', size = '') {
    const { score, settings } = load(kind, size);
    const f = new MidiFile();
    new MidiFileGenerator(score, settings, new AlphaSynthMidiFileHandler(f)).generate();
    return f.tracks.flatMap(t => t.events).filter(e => e instanceof NoteEvent);
}
function svg(kind = 'cue', size = '') {
    const { score, settings } = load(kind, size),
        r = new ScoreRenderer(settings),
        out: string[] = [];
    r.width = 800;
    r.partialRenderFinished.on(e => {
        if (typeof e.renderResult === 'string') {
            out.push(e.renderResult);
        }
    });
    r.renderScore(score, [0]);
    return out.join('');
}
describe('silent MusicXML cues', () => {
    it('preserves a cue head and its ordinary notated duration without making it a grace', () => {
        const { score } = load(),
            beats = score.tracks[0].staves[0].bars[0].voices[0].beats;
        expect(beats.map(b => b.notes.map(n => n.realValue))).toEqual([[72], [74]]);
        expect(beats[0].notes[0].isCue).toBe(true);
        expect(beats[0].notes[0].isSmall).toBe(true);
        expect(beats.map(b => [b.displayStart, b.playbackStart, b.playbackDuration, b.graceType])).toEqual([
            [0, 0, 960, 0],
            [960, 960, 960, 0]
        ]);
    });
    it('retains cue silence and size through Worker JSON', () => {
        const { score } = load(),
            copy = JsonConverter.jsObjectToScore(JsonConverter.scoreToJsObject(score));
        expect(copy.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0].isCue).toBe(true);
        expect(copy.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0].isSmall).toBe(true);
    });
    it('does not generate note on or off for a cue, preserving the following note tick', () => {
        const notes = events();
        expect(notes).toHaveLength(2);
        expect(notes.map(e => [e.noteKey, e.tick])).toEqual([
            [74, 960],
            [74, 1920]
        ]);
    });
    it('keeps full-size cue silent while normal cue-size notes still play', () => {
        const { score } = load('cue', 'full');
        expect(score.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0].isSmall).toBe(false);
        expect(events('cue', 'full')).toHaveLength(2);
        expect(events('normal', 'cue')).toHaveLength(4);
        expect(load('normal', 'cue').score.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0].isCue).toBe(false);
    });
    it('actually draws a small cue head; full-size cue and regular note have equal layout', () => {
        expect(svg()).toContain('font-size: 75%');
        expect(svg('cue', 'full')).toBe(svg('normal'));
    });
});

describe('cue note mixed with ordinary chord heads', () => {
    it('does not silence ordinary heads at the same onset', () => {
        const { score, settings } = load('normal');
        const first = score.tracks[0].staves[0].bars[0].voices[0].beats[0];
        const cue = JsonConverter.jsObjectToScore(JsonConverter.scoreToJsObject(score)).tracks[0].staves[0].bars[0]
            .voices[0].beats[0].notes[0];
        cue.tone = 4;
        cue.isCue = true;
        cue.isSmall = true;
        first.addNote(cue);
        expect(first.isSmall).toBe(false);
        const f = new MidiFile();
        new MidiFileGenerator(score, settings, new AlphaSynthMidiFileHandler(f)).generate();
        const notes = f.tracks.flatMap(t => t.events).filter(e => e instanceof NoteEvent);
        expect(notes.map(e => e.noteKey)).toEqual([72, 72, 74, 74]);
    });
});

describe('cue synthesis silence', () => {
    it('synthesizes exactly the same PCM as a rest of the same duration', async () => {
        const soundFont = await TestPlatform.loadFile('test-data/audio/default.sf2');
        function pcm(kind: string) {
            const { score, settings } = load(kind),
                file = new MidiFile();
            new MidiFileGenerator(score, settings, new AlphaSynthMidiFileHandler(file)).generate();
            const output = new TestOutput(),
                synth = new AlphaSynth(output, 500);
            synth.loadSoundFont(soundFont, false);
            synth.loadMidiFile(file);
            let finished = false;
            synth.finished.on(() => {
                finished = true;
            });
            synth.play();
            for (let i = 0; i < 200 && !finished; i++) {
                output.next();
            }
            expect(finished).toBe(true);
            return output.samples.flatMap(x => Array.from(x));
        }
        const cue = pcm('cue'),
            rest = pcm('rest');
        expect(cue).toEqual(rest);
        expect(cue.slice(0, 20000).every(x => x === 0)).toBe(true);
        expect(cue.some(x => Math.abs(x) > 0.0001)).toBe(true);
    });
});

// A cue may carry a visual <tied>, but MusicXML forbids its sounding <tie>.
// Keep the engraving link without silencing or lengthening an ordinary neighbour.
for (const cueFirst of [true, false]) {
    it(`keeps a visual cue tie separate from ordinary playback (cue first: ${cueFirst})`, () => {
        const xml = `<score-partwise version="4.0"><part-list><score-part id="P"><part-name>Voice</part-name></score-part></part-list><part id="P"><measure number="1"><attributes><divisions>1</divisions><time><beats>2</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>${[true, false].map(first => `<note>${first === cueFirst ? '<cue/>' : ''}<pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><type>quarter</type><notations><tied type="${first ? 'start' : 'stop'}"/></notations></note>`).join('')}</measure></part></score-partwise>`;
        const settings = new Settings(),
            importer = new MusicXmlImporter();
        importer.init(ByteBuffer.fromBuffer(new TextEncoder().encode(xml)), settings);
        const score = JsonConverter.jsObjectToScore(JsonConverter.scoreToJsObject(importer.readScore()));
        const beats = score.tracks[0].staves[0].bars[0].voices[0].beats;
        expect(beats[0].notes[0].tieDestination).toBe(beats[1].notes[0]);
        const file = new MidiFile();
        new MidiFileGenerator(score, settings, new AlphaSynthMidiFileHandler(file)).generate();
        const notes = file.tracks.flatMap(t => t.events).filter(e => e instanceof NoteEvent);
        expect(notes.map(e => [e.noteKey, e.tick])).toEqual(
            cueFirst
                ? [
                      [72, 960],
                      [72, 1920]
                  ]
                : [
                      [72, 0],
                      [72, 960]
                  ]
        );
    });
}

for (const layout of [LayoutMode.Page, LayoutMode.Horizontal]) {
    for (const regularStem of ['up', 'down']) {
        it(`separates a timed cue head from a simultaneous regular head (${LayoutMode[layout]}, ${regularStem} stem)`, async () => {
            const xml =
                '<score-partwise version="4.0"><part-list><score-part id="P"><part-name>Piano</part-name></score-part></part-list><part id="P"><measure number="1"><attributes><divisions>1</divisions><time><beats>1</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><stem>' +
                regularStem +
                '</stem></note><backup><duration>1</duration></backup><note><cue/><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><voice>2</voice><type size="cue">quarter</type><stem>up</stem></note></measure></part></score-partwise>';
            const settings = new Settings();
            settings.core.engine = 'svg';
            settings.core.includeNoteBounds = true;
            settings.core.enableLazyLoading = false;
            settings.display.staveProfile = StaveProfile.Score;
            settings.display.layoutMode = layout;
            const importer = new MusicXmlImporter();
            importer.init(ByteBuffer.fromBuffer(new TextEncoder().encode(xml)), settings);
            const score = importer.readScore(),
                renderer = new ScoreRenderer(settings);
            renderer.width = 800;
            renderer.error.on(error => {
                throw error;
            });
            const pieces: string[] = [];
            renderer.partialRenderFinished.on(e => {
                if (typeof e.renderResult === 'string') {
                    pieces.push(e.renderResult);
                }
            });
            renderer.renderScore(score, [0]);
            // Bounds precede shared multi-voice paint shifts. Read the actual SVG positions.
            // Different-size slanted heads can have overlapping bounding rectangles while
            // their contours are separate; test real glyph ink rather than a magic gap.
            const heads = [
                ...pieces
                    .join('')
                    .matchAll(
                        /<g transform="translate\(([-\d.]+) ([-\d.]+)\)" class="at" ><text([^>]*)>&#57508;<\/text><\/g>/g
                    )
            ]
                .map(m => ({ x: Number(m[1]), y: Number(m[2]), fontSize: m[3].includes('75%') ? 27 : 36 }))
                .sort((a, b) => a.x - b.x);
            expect(heads).toHaveLength(2);
            AlphaSkiaCanvas.switchToFreeTypeFonts();
            const fontBytes = await TestPlatform.loadFile('font/bravura/Bravura.otf');
            using typeface = AlphaSkiaTypeface.register(new Uint8Array(fontBytes).buffer)!;
            using style = new AlphaSkiaTextStyle([typeface.familyName], 400, false);
            const resolution = 16;
            function ink(head: (typeof heads)[0], x = head.x) {
                using canvas = new AlphaSkiaCanvas();
                canvas.beginRender(100 * resolution, 80 * resolution);
                canvas.color = AlphaSkiaCanvas.rgbaToColor(0, 0, 0, 255);
                canvas.fillText(
                    String.fromCharCode(57508),
                    style,
                    head.fontSize * resolution,
                    (20 + x - heads[0].x) * resolution,
                    (40 + head.y - heads[0].y) * resolution,
                    AlphaSkiaTextAlign.Left,
                    AlphaSkiaTextBaseline.Alphabetic
                );
                using image = canvas.endRender()!;
                return new Uint8Array(image.readPixels()!);
            }
            const cueHead = heads.find(h => h.fontSize === 27)!,
                normalHead = heads.find(h => h.fontSize === 36)!;
            const cue = ink(cueHead),
                ordinary = ink(normalHead),
                unshifted = ink(normalHead, cueHead.x);
            const metrics = settings.display.resources.engravingSettings;
            const stemLeft = normalHead.x + metrics.stemUp.get(MusicFontSymbol.NoteheadBlack)!.x;
            const stemRight = stemLeft + metrics.stemThickness;
            if (regularStem === 'up') {
                // Same-direction heads legitimately touch on their shared stem. Its
                // attachment band comes from SMuFL, not a hand-tuned spacing allowance.
                expect(cueHead.x).toBeCloseTo(stemLeft, 2);
            }
            let cuePixels = 0,
                overlapsOutsideStem = 0,
                unshiftedOverlaps = 0;
            for (let i = 3; i < cue.length; i += 4) {
                if (cue[i]) {
                    cuePixels++;
                }
                if (cue[i] && ordinary[i]) {
                    const pixelX = (((i - 3) / 4) % (100 * resolution)) / resolution - 20 + heads[0].x;
                    // One raster sample accounts only for antialias coverage of the edge.
                    if (
                        regularStem !== 'up' ||
                        pixelX < stemLeft - 1 / resolution ||
                        pixelX > stemRight + 1 / resolution
                    ) {
                        overlapsOutsideStem++;
                    }
                }
                if (cue[i] && unshifted[i]) {
                    unshiftedOverlaps++;
                }
            }
            expect(cuePixels).toBeGreaterThan(0);
            expect(unshiftedOverlaps).toBeGreaterThan(cuePixels * 0.9);
            expect(overlapsOutsideStem, `Actual head ink at ${JSON.stringify(heads)}`).toBe(0);
            renderer.destroy();
        });
    }
}
