import { MusicXmlImporter } from '@coderline/alphatab/importer/MusicXmlImporter';
import { ByteBuffer } from '@coderline/alphatab/io/ByteBuffer';
import { AlphaSynthMidiFileHandler } from '@coderline/alphatab/midi/AlphaSynthMidiFileHandler';
import { MidiFile } from '@coderline/alphatab/midi/MidiFile';
import { MidiFileGenerator } from '@coderline/alphatab/midi/MidiFileGenerator';
import { SourceDynamic } from '@coderline/alphatab/model/Bar';
import { DynamicValue } from '@coderline/alphatab/model/DynamicValue';
import { JsonConverter } from '@coderline/alphatab/model/JsonConverter';
import { MusicFontSymbol } from '@coderline/alphatab/model/MusicFontSymbol';
import { ScoreRenderer } from '@coderline/alphatab/rendering/ScoreRenderer';
import { Settings } from '@coderline/alphatab/Settings';
import { StaveProfile } from '@coderline/alphatab/StaveProfile';
import { describe, expect, it } from 'vitest';

function load(hidden = true, dotted = false, secondVoice = false, whole = false, directions = false) {
    const rest = (visible: boolean, voice: number) =>
        `<note${visible ? '' : ' print-object="no"'}><rest/><duration>${whole ? 8 : dotted ? 3 : 2}</duration><voice>${voice}</voice><type>${whole ? 'whole' : 'quarter'}</type>${dotted ? '<dot/>' : ''}</note>`;
    const note = (voice: number) =>
        `<note><pitch><step>D</step><octave>5</octave></pitch><duration>${dotted ? 3 : 2}</duration><voice>${voice}</voice><type>quarter</type>${dotted ? '<dot/>' : ''}</note>`;
    const xml = `<score-partwise version="4.0"><part-list><score-part id="P"><part-name>Piano</part-name></score-part></part-list><part id="P"><measure number="1"><attributes><divisions>2</divisions><time><beats>${whole ? 4 : dotted ? 3 : 2}</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>${directions ? '<direction><direction-type><words>KEEP INDEPENDENT</words></direction-type></direction><direction><direction-type><dynamics><pp/></dynamics></direction-type></direction>' : ''}${rest(!hidden, 1)}${whole ? '' : note(1)}${secondVoice ? `<backup><duration>${dotted ? 6 : 4}</duration></backup>${rest(true, 2)}${note(2)}` : ''}</measure></part></score-partwise>`;
    const settings = new Settings();
    settings.core.engine = 'svg';
    settings.core.enableLazyLoading = false;
    settings.display.staveProfile = StaveProfile.Score;
    const imp = new MusicXmlImporter();
    imp.init(ByteBuffer.fromBuffer(new TextEncoder().encode(xml)), settings);
    return { score: imp.readScore(), settings };
}
function render(hidden = true, dotted = false, secondVoice = false, whole = false) {
    return picture(load(hidden, dotted, secondVoice, whole));
}
function picture({ score, settings }: ReturnType<typeof load>) {
    const r = new ScoreRenderer(settings),
        pieces: string[] = [];
    r.width = 800;
    r.partialRenderFinished.on(x => {
        if (typeof x.renderResult === 'string') {
            pieces.push(x.renderResult);
        }
    });
    r.renderScore(score, [0]);
    return pieces.join('');
}
function midi(hidden: boolean) {
    const { score, settings } = load(hidden),
        f = new MidiFile();
    new MidiFileGenerator(score, settings, new AlphaSynthMidiFileHandler(f)).generate();
    return f.tracks.flatMap(t => t.events).map(x => JSON.stringify(x));
}
const count = (svg: string, symbol: MusicFontSymbol) => svg.split(`&#${symbol};`).length - 1;
describe('MusicXML rest print-object visibility', () => {
    it('does not print a hidden rest but keeps the following note and visible rest', () => {
        expect(count(render(), MusicFontSymbol.RestQuarter)).toBe(0);
        expect(count(render(false), MusicFontSymbol.RestQuarter)).toBe(1);
        expect(count(render(), MusicFontSymbol.NoteheadBlack)).toBe(1);
    });
    it('preserves visibility through Worker JSON without turning the rest into empty music', () => {
        const { score } = load(),
            copy = JsonConverter.jsObjectToScore(JsonConverter.scoreToJsObject(score)),
            b = copy.tracks[0].staves[0].bars[0].voices[0].beats[0];
        expect(b.isRestVisible).toBe(false);
        expect(b.isEmpty).toBe(false);
        expect(b.isRest).toBe(true);
        expect(b.playbackDuration).toBe(960);
    });
    it('hides augmentation dots along with their rest, not the next dotted note', () => {
        expect(count(render(true, true), MusicFontSymbol.AugmentationDot)).toBe(1);
        expect(count(render(false, true), MusicFontSymbol.AugmentationDot)).toBe(2);
    });
    it('keeps rest spacing, note attack coordinates and every MIDI event unchanged', () => {
        const position = (s: string) =>
            [
                ...s.matchAll(
                    new RegExp(
                        `<g transform="translate\\(([^)]+)\\)"[^>]*><text[^>]*>&#${MusicFontSymbol.NoteheadBlack};`,
                        'g'
                    )
                )
            ].map(m => m[1]);
        expect(position(render())).toEqual(position(render(false)));
        expect(midi(true)).toEqual(midi(false));
    });
    it('never lets a hidden rest suppress another voice visible rest', () => {
        expect(count(render(true, false, true), MusicFontSymbol.RestQuarter)).toBe(1);
    });
});

it('hides a full-measure rest without changing ordinary visible whole-bar rest support', () => {
    expect(count(render(true, false, false, true), MusicFontSymbol.RestWhole)).toBe(0);
    expect(count(render(false, false, false, true), MusicFontSymbol.RestWhole)).toBe(1);
});
for (const mode of ['slash', 'numbered', 'tab']) {
    it(`applies rest visibility to the ${mode} notation profile`, () => {
        function picture(hidden: boolean) {
            const { score, settings } = load(hidden),
                staff = score.tracks[0].staves[0];
            settings.display.staveProfile = StaveProfile.Default;
            staff.showStandardNotation = false;
            staff.showTablature = mode === 'tab';
            staff.showSlash = mode === 'slash';
            staff.showNumbered = mode === 'numbered';
            if (mode === 'tab') {
                staff.stringTuning.tunings = [64, 59, 55, 50, 45, 40];
                for (const b of staff.bars[0].voices[0].beats) {
                    for (const n of b.notes) {
                        n.string = 1;
                        n.fret = 10;
                    }
                }
            }
            const r = new ScoreRenderer(settings),
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
        if (mode === 'numbered') {
            expect(picture(false)).toContain('>0</text>');
            expect(picture(true)).not.toContain('>0</text>');
        } else {
            expect(count(picture(false), MusicFontSymbol.RestQuarter)).toBe(1);
            expect(count(picture(true), MusicFontSymbol.RestQuarter)).toBe(0);
        }
    });
}

it('keeps old Worker JSON without the visibility field visible by default', () => {
    const { score, settings } = load(false);
    const legacy = JSON.stringify(JSON.parse(JsonConverter.scoreToJson(score)), (key, value) =>
        key === 'isrestvisible' ? undefined : value
    );
    expect(legacy).not.toContain('isrestvisible');
    const copy = JsonConverter.jsonToScore(legacy);
    expect(copy.tracks[0].staves[0].bars[0].voices[0].beats[0].isRestVisible).toBe(true);
    expect(count(picture({ score: copy, settings }), MusicFontSymbol.RestQuarter)).toBe(1);
});
it('retains independent source direction words and projected dynamics while hiding rest ink', () => {
    const input = load(true, false, false, false, true),
        bar = input.score.tracks[0].staves[0].bars[0];
    // Chorus projects exact MusicXML source directions onto this native public API.
    // This native test exercises that caller seam; it does not pretend the importer does that projection.
    input.score.stylesheet.hideDynamics = false;
    bar.sourceDynamics = [Object.assign(new SourceDynamic(), { displayStart: 0, value: DynamicValue.PP })];
    const svg = picture(input);
    expect(count(svg, MusicFontSymbol.RestQuarter)).toBe(0);
    expect(svg).toContain('KEEP INDEPENDENT');
    expect(count(svg, MusicFontSymbol.DynamicPP)).toBe(1);
});
