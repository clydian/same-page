import { NoteCloner } from '@coderline/alphatab/generated/model/NoteCloner';
import { LayoutMode } from '@coderline/alphatab/LayoutMode';
import { AlphaSynthMidiFileHandler } from '@coderline/alphatab/midi/AlphaSynthMidiFileHandler';
import { MidiFile } from '@coderline/alphatab/midi/MidiFile';
import { MidiFileGenerator } from '@coderline/alphatab/midi/MidiFileGenerator';
import { JsonConverter } from '@coderline/alphatab/model/JsonConverter';
import { MusicFontSymbol } from '@coderline/alphatab/model/MusicFontSymbol';
import type { Score } from '@coderline/alphatab/model/Score';
import { ScoreLoader } from '@coderline/alphatab/importer/ScoreLoader';
import { ScoreRenderer } from '@coderline/alphatab/rendering/ScoreRenderer';
import { Settings } from '@coderline/alphatab/Settings';
import { StaveProfile } from '@coderline/alphatab/StaveProfile';
import { expect, it } from 'vitest';

const mark = '<notations><articulations><falloff/></articulations></notations>';
const xml = `<score-partwise version="4.0">
<part-list><score-part id="P"><part-name>Piano</part-name></score-part></part-list>
<part id="P"><measure number="1">
<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
<note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type>${mark}</note>
<note><chord/><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
<note print-object="no"><chord/><pitch><step>B</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type>${mark}</note>
<note><pitch><step>A</step><octave>4</octave></pitch><duration>3</duration><type>half</type><dot/></note>
</measure></part></score-partwise>`;

const load = (source: string) => ScoreLoader.loadScoreFromBytes(new TextEncoder().encode(source), new Settings());
const chord = (score: Score) => score.tracks[0].staves[0].bars[0].voices[0].beats[0].notes;

function render(score: Score, layoutMode: LayoutMode): string {
    const settings = new Settings();
    settings.core.engine = 'svg';
    settings.core.enableLazyLoading = false;
    settings.display.staveProfile = StaveProfile.Score;
    settings.display.layoutMode = layoutMode;
    const renderer = new ScoreRenderer(settings);
    renderer.width = 800;
    let svg = '';
    renderer.partialRenderFinished.on(e => {
        if (typeof e.renderResult === 'string') {
            svg += e.renderResult;
        }
    });
    renderer.error.on(error => {
        throw error;
    });
    try {
        renderer.renderScore(score, [0]);
        return svg;
    } finally {
        renderer.destroy();
    }
}

it.each([LayoutMode.Page, LayoutMode.Horizontal])('draws only the authored visible falloff in layout %s', layout => {
    const marked = JsonConverter.jsonToScore(JsonConverter.scoreToJson(load(xml)));
    const unmarked = load(xml.replaceAll(mark, ''));
    const glyph = `&#${MusicFontSymbol.BrassFallLipShort};`;
    expect(render(marked, layout).split(glyph)).toHaveLength(2);
    expect(render(unmarked, layout)).not.toContain(glyph);
});

it('preserves per-head display metadata and the entire synth MIDI sequence', () => {
    const score = load(xml);
    expect(chord(score).map(note => note.isSourceFalloff)).toEqual([true, false, true]);
    expect(NoteCloner.clone(chord(score)[0]).isSourceFalloff).toBe(true);

    const legacy = JSON.parse(JsonConverter.scoreToJson(score), (key, value) =>
        key === 'issourcefalloff' ? undefined : value
    );
    expect(chord(JsonConverter.jsObjectToScore(legacy)).map(note => note.isSourceFalloff)).toEqual([false, false, false]);

    const synthEvents = (input: Score) => {
        const file = new MidiFile();
        new MidiFileGenerator(input, new Settings(), new AlphaSynthMidiFileHandler(file)).generate();
        return file.tracks.flatMap(track => track.events);
    };
    expect(synthEvents(score)).toEqual(synthEvents(load(xml.replaceAll(mark, ''))));
});
