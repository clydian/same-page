import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { BeatCloner } from '@coderline/alphatab/generated/model/BeatCloner';
import { MusicXmlImporter } from '@coderline/alphatab/importer/MusicXmlImporter';
import { ByteBuffer } from '@coderline/alphatab/io/ByteBuffer';
import { LayoutMode } from '@coderline/alphatab/LayoutMode';
import { AlphaSynthMidiFileHandler } from '@coderline/alphatab/midi/AlphaSynthMidiFileHandler';
import { MidiFile } from '@coderline/alphatab/midi/MidiFile';
import { MidiFileGenerator } from '@coderline/alphatab/midi/MidiFileGenerator';
import { JsonConverter } from '@coderline/alphatab/model/JsonConverter';
import type { Score } from '@coderline/alphatab/model/Score';
import { ScoreRestGlyph } from '@coderline/alphatab/rendering/glyphs/ScoreRestGlyph';
import { ScoreBarRenderer } from '@coderline/alphatab/rendering/ScoreBarRenderer';
import { ScoreRenderer } from '@coderline/alphatab/rendering/ScoreRenderer';
import { Settings } from '@coderline/alphatab/Settings';
import { StaveProfile } from '@coderline/alphatab/StaveProfile';
import { expect, it, vi } from 'vitest';

const xml = (content: string) => `<score-partwise version="4.0"><part-list><score-part id="P"><part-name>Piano</part-name></score-part></part-list><part id="P">${content}</part></score-partwise>`;
const display = (step = 'E', octave = 4) => `<display-step>${step}</display-step><display-octave>${octave}</display-octave>`;
function source(position = display(), clef = '<sign>G</sign><line>2</line>', type = 'whole', divisions = 1, duration = 4, multiple = true) {
    return xml(`<measure number="1"><attributes><divisions>${divisions}</divisions><time><beats>${duration}</beats><beat-type>${divisions * 4}</beat-type></time><clef>${clef}</clef></attributes><direction><direction-type><dynamics><mf/></dynamics></direction-type></direction>${multiple ? `<note><pitch><step>G</step><octave>5</octave></pitch><duration>${duration}</duration><voice>1</voice><type>${type}</type></note><backup><duration>${duration}</duration></backup>` : ''}<note><rest${type === 'whole' ? ' measure="yes"' : ''}>${position}</rest><duration>${duration}</duration><voice>${multiple ? 2 : 1}</voice><type>${type}</type></note></measure>`);
}
function load(input = source()) {
    const importer = new MusicXmlImporter();
    importer.init(ByteBuffer.fromBuffer(new TextEncoder().encode(input)), new Settings());
    return importer.readScore();
}
const rests = (s: Score) => s.tracks.flatMap(t => t.staves.flatMap(st => st.bars.flatMap(b => b.voices.flatMap(v => v.beats.filter(be => be.isRest && !be.isEmpty)))));
function midi(score: Score) {
    const file = new MidiFile();
    const generator = new MidiFileGenerator(score, new Settings(), new AlphaSynthMidiFileHandler(file));
    generator.applyTranspositionPitches = false;
    generator.generate();
    return { events: file.tracks.map(t => t.events.map(e => JSON.stringify(e))), bounds: generator.tickLookup.masterBars.map(b => [b.start, b.end]) };
}
function render(score: Score, mode = LayoutMode.Page, startBar = 1, barCount = -1) {
    const settings = new Settings();
    settings.core.engine = 'svg'; settings.core.enableLazyLoading = false;
    settings.display.staveProfile = StaveProfile.Score; settings.display.layoutMode = mode;
    settings.display.startBar = startBar; settings.display.barCount = barCount;
    const origins = new Map<ScoreBarRenderer, number>();
    const positions: { bar: number; staff: number; voice: number; steps: number; localY: number; finalY: number; topLineY: number }[] = [];
    const paintBar = ScoreBarRenderer.prototype.paint;
    const barSpy = vi.spyOn(ScoreBarRenderer.prototype, 'paint').mockImplementation(function (this: ScoreBarRenderer, cx, cy, canvas) {
        origins.set(this, cy + this.y);
        return paintBar.call(this, cx, cy, canvas);
    });
    const paintRest = ScoreRestGlyph.prototype.paint;
    const restSpy = vi.spyOn(ScoreRestGlyph.prototype, 'paint').mockImplementation(function (this: ScoreRestGlyph, cx, cy, canvas) {
        const r = this.renderer as ScoreBarRenderer;
        const topLineY = origins.get(r)! + r.getScoreY(0), finalY = cy + this.y;
        positions.push({ bar: this.beat!.voice.bar.index + 1, staff: this.beat!.voice.bar.staff.index, voice: this.beat!.voice.index, steps: (finalY - topLineY) / r.getScoreHeight(1), localY: this.y, finalY, topLineY });
        return paintRest.call(this, cx, cy, canvas);
    });
    const renderer = new ScoreRenderer(settings); renderer.width = 1000;
    const pieces: string[] = [];
    renderer.partialRenderFinished.on(e => { if (typeof e.renderResult === 'string') { pieces.push(e.renderResult); } });
    renderer.error.on(error => { throw error; });
    try { renderer.renderScore(score, score.tracks.map(t => t.index)); return { svg: pieces.join(''), positions }; }
    finally { renderer.destroy(); restSpy.mockRestore(); barSpy.mockRestore(); }
}
function artifact(name: string, value: unknown) {
    const root = process.env.REST_DISPLAY_ARTIFACTS;
    if (root) { mkdirSync(root, { recursive: true }); writeFileSync(`${root}/${name}`, typeof value === 'string' ? value : JSON.stringify(value, null, 2)); }
}
function expectSteps(actual: number[], expected: number[]) {
    expect(actual).toHaveLength(expected.length);
    // Canvas origin additions/subtractions introduce machine-epsilon noise.
    // Retain raw coordinates in controls, with a 1e-10 half-staff-step limit.
    actual.forEach((value, index) => { expect(value).toBeCloseTo(expected[index], 10); });
}

for (const mode of [LayoutMode.Page, LayoutMode.Horizontal]) {
    it(`source66 whole rest actually paints on bottom E4, mode=${LayoutMode[mode]}`, () => {
        const result = render(load(), mode);
        artifact(`source66-minimal-${LayoutMode[mode]}.svg`, result.svg);
        artifact(`source66-minimal-${LayoutMode[mode]}.json`, result.positions);
        expectSteps(result.positions.map(p => p.steps), [8]);
    });
}
for (const [clef, position, expected] of [
    ['<sign>G</sign><line>2</line>', display(), 8],
    ['<sign>F</sign><line>4</line>', display('G', 2), 8],
    ['<sign>C</sign><line>3</line>', display('C', 4), 4],
    ['<sign>C</sign><line>4</line>', display('C', 4), 2],
    ['<sign>percussion</sign>', display(), 8],
] as const) {
    it(`interprets display spelling with clef ${clef}`, () => {
        const score = load(source(position, clef, 'whole', 1, 4, false));
        expectSteps(render(score).positions.map(p => p.steps), [expected]);
    });
}
it('preserves written rest step through generated Beat clone and Worker JSON without notes', () => {
    const score = load();
    expect(rests(score)[0].restDisplayStep).toBe(30); // C0=0, E4=4*7+2
    expect(BeatCloner.clone(rests(score)[0]).restDisplayStep).toBe(30);
    const copy = JsonConverter.jsObjectToScore(structuredClone(JsonConverter.scoreToJsObject(score)));
    expect(rests(copy)[0].restDisplayStep).toBe(30);
    expect(rests(copy)[0].notes).toHaveLength(0);
    expectSteps(render(copy).positions.map(p => p.steps), [8]);
    expect(midi(copy)).toEqual(midi(score));
});
it('uses the timed clef at each rest, including a change within the bar', () => {
    const rest = `<note><rest>${display('C', 4)}</rest><duration>1</duration><type>quarter</type></note>`;
    const score = load(xml(`<measure number="1"><attributes><divisions>1</divisions><time><beats>2</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>${rest}<attributes><clef><sign>F</sign><line>4</line></clef></attributes>${rest}</measure>`));
    expectSteps(render(score).positions.map(p => p.steps), [10, -2]);
});
it('keeps separately positioned simultaneous rests visible in both secondary voices', () => {
    const input = source().replace('</measure>', `<backup><duration>4</duration></backup><note><rest measure="yes">${display('E', 5)}</rest><duration>4</duration><voice>3</voice><type>whole</type></note></measure>`);
    const positions = render(load(input)).positions.sort((a, b) => a.voice - b.voice);
    expect(positions.map(p => p.voice)).toEqual([1, 2]);
    expectSteps(positions.map(p => p.steps), [8, 1]);
});
it('changes no MIDI event, bar boundary, voice duration or note for display-only rest coordinates', () => {
    const plain = load(source('')), marked = load();
    expect(midi(marked)).toEqual(midi(plain));
    expect(midi(marked).bounds).toEqual([[0, 3840]]);
    expect(midi(marked).events.flat().filter(e => e.includes('"type":128')).length).toBe(1);
    const rhythm = (s: Score) => s.tracks.flatMap(t => t.staves.flatMap(st => st.bars.flatMap(b => b.voices.map(v => v.beats.map(be => [be.displayStart, be.playbackStart, be.playbackDuration, be.notes.map(n => n.realValue)])))));
    expect(rhythm(marked)).toEqual(rhythm(plain));
});
for (const [type, divisions, duration, expected] of [
    ['long', 1, 16, 4], ['breve', 1, 8, 4], ['whole', 1, 4, 2], ['half', 1, 2, 4], ['quarter', 1, 1, 4], ['eighth', 2, 1, 4], ['16th', 4, 1, 4], ['32nd', 8, 1, 4], ['64th', 16, 1, 4], ['128th', 32, 1, 4], ['256th', 64, 1, 4],
] as const) {
    it(`keeps the previous ${type} rest without display coordinates exact`, () => {
        const score = load(source('', undefined, type, divisions, duration, false));
        const result = render(score);
        artifact(`default-${type}.svg`, result.svg);
        artifact(`default-${type}.json`, { positions: result.positions, midi: midi(score) });
        expect(rests(score)[0].restDisplayStep ?? null).toBe(null);
        expectSteps(result.positions.map(p => p.steps), [expected]);
        const json = JSON.stringify(JsonConverter.scoreToJsObject(score), (key, value) => key.toLowerCase() === 'restdisplaystep' ? undefined : value instanceof Map ? Object.fromEntries(value) : value);
        const legacy = JsonConverter.jsObjectToScore(JSON.parse(json));
        expect(rests(legacy)[0].restDisplayStep ?? null).toBe(null);
        expect(render(legacy)).toEqual(result);
        expect(midi(legacy)).toEqual(midi(score));
    });
}
for (const position of ['<display-step>E</display-step>', display('H'), display('E', 10)]) {
    it(`falls back for incomplete/invalid rest coordinates ${position}`, () => {
        const score = load(source(position));
        expect(rests(score)[0].restDisplayStep).toBe(null);
        expect(render(score)).toEqual(render(load(source(''))));
    });
}
it.skipIf(!process.env.REST_DISPLAY_SOURCE_XML)('records external source context and full native MIDI for independent before/after controls', () => {
    const real = readFileSync(process.env.REST_DISPLAY_SOURCE_XML!, 'utf8');
    const score = load(real);
    artifact('real-source66-full-native-midi.json', midi(score));
    for (const mode of [LayoutMode.Page, LayoutMode.Horizontal]) {
        const result = render(score, mode, 65, 3);
        artifact(`real-source65-67-${LayoutMode[mode]}.svg`, result.svg);
        artifact(`real-source65-67-${LayoutMode[mode]}.json`, result.positions);
    }
});
