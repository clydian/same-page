import { BeatCloner } from '@coderline/alphatab/generated/model/BeatCloner';
import { MusicXmlImporter } from '@coderline/alphatab/importer/MusicXmlImporter';
import { ByteBuffer } from '@coderline/alphatab/io/ByteBuffer';
import { DynamicValue } from '@coderline/alphatab/model/DynamicValue';
import { JsonConverter } from '@coderline/alphatab/model/JsonConverter';
import { MusicFontSymbol } from '@coderline/alphatab/model/MusicFontSymbol';
import { DynamicsEffectInfo } from '@coderline/alphatab/rendering/effects/DynamicsEffectInfo';
import { ScoreRenderer } from '@coderline/alphatab/rendering/ScoreRenderer';
import { Settings } from '@coderline/alphatab/Settings';
import { StaveProfile } from '@coderline/alphatab/StaveProfile';
import { describe, expect, it } from 'vitest';

const input = `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Voice</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><type>quarter</type></note><note><rest/><duration>1</duration><type>quarter</type></note><note><pitch><step>D</step><octave>5</octave></pitch><duration>2</duration><type>half</type></note></measure></part></score-partwise>`;
function load(xml = input) {
    const settings = new Settings();
    settings.core.engine = 'svg';
    settings.core.enableLazyLoading = false;
    settings.display.staveProfile = StaveProfile.Score;
    const importer = new MusicXmlImporter();
    importer.init(ByteBuffer.fromBuffer(new TextEncoder().encode(xml)), settings);
    const score = importer.readScore();
    // This caller supplies explicit source declarations after import.
    score.stylesheet.hideDynamics = false;
    return { score, settings };
}
describe('explicit source dynamic engraving', () => {
    it('draws an exact declaration on an existing empty cross-staff time anchor', () => {
        const xml = `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes><note><pitch><step>C</step><octave>3</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>2</staff></note><note><pitch><step>D</step><octave>4</octave></pitch><duration>3</duration><voice>1</voice><type>half</type><dot/><staff>1</staff></note></measure></part></score-partwise>`;
        const { score, settings } = load(xml);
        const empty = score.tracks[0].staves[0].bars[0].voices[0].beats[0];
        expect(empty.isEmpty).toBe(true);
        expect(empty.playbackStart).toBe(0);
        for (const staff of score.tracks[0].staves) {
            for (const voice of staff.bars[0].voices) {
                for (const beat of voice.beats) {
                    beat.dynamics = DynamicValue.P;
                }
            }
        }
        empty.dynamics = DynamicValue.PP;
        empty.isDynamicsExplicit = true;
        const renderer = new ScoreRenderer(settings),
            svg: string[] = [];
        renderer.width = 1000;
        renderer.error.on(error => {
            throw error;
        });
        renderer.partialRenderFinished.on(e => {
            if (typeof e.renderResult === 'string') {
                svg.push(e.renderResult);
            }
        });
        renderer.renderScore(score, [0]);
        expect(svg.join('').split(`&#${MusicFontSymbol.DynamicPP};`).length - 1).toBe(1);
    });
    it('draws a source declaration at a rest rather than carrying its glyph to the next note', () => {
        const { score, settings } = load();
        const beats = score.tracks[0].staves[0].bars[0].voices[0].beats;
        for (const beat of beats) {
            beat.dynamics = DynamicValue.P;
        }
        const rest = beats[1];
        rest.dynamics = DynamicValue.PP;
        rest.isDynamicsExplicit = true;
        const effect = new DynamicsEffectInfo();
        expect(effect.shouldCreateGlyph(settings, rest)).toBe(true);
        const renderer = new ScoreRenderer(settings),
            svg: string[] = [];
        renderer.width = 1000;
        renderer.error.on(error => {
            throw error;
        });
        renderer.partialRenderFinished.on(e => {
            if (typeof e.renderResult === 'string') {
                svg.push(e.renderResult);
            }
        });
        renderer.renderScore(score, [0]);
        expect(svg.join('').split(`&#${MusicFontSymbol.DynamicPP};`).length - 1).toBe(1);
    });
    it('retains consecutive equal source declarations but keeps legacy suppression', () => {
        const { score, settings } = load(input.replace('<rest/>', '<pitch><step>E</step><octave>5</octave></pitch>'));
        const beats = score.tracks[0].staves[0].bars[0].voices[0].beats;
        for (const beat of beats) {
            beat.dynamics = DynamicValue.P;
        }
        const effect = new DynamicsEffectInfo();
        expect(effect.shouldCreateGlyph(settings, beats[1])).toBe(false);
        beats[1].isDynamicsExplicit = true;
        expect(effect.shouldCreateGlyph(settings, beats[1])).toBe(true);
        score.stylesheet.hideDynamics = true;
        expect(effect.shouldCreateGlyph(settings, beats[1])).toBe(false);
    });
    it('supports a real whole-bar rest in an otherwise empty voice', () => {
        const { score, settings } = load(
            input.replace(
                /<note>[\s\S]*<\/note>/,
                '<note><rest measure="yes"/><duration>4</duration><type>whole</type></note>'
            )
        );
        const rest = score.tracks[0].staves[0].bars[0].voices[0].beats[0];
        rest.dynamics = DynamicValue.PP;
        rest.isDynamicsExplicit = true;
        expect(new DynamicsEffectInfo().shouldCreateGlyph(settings, rest)).toBe(true);
    });
    it('does not repeat an explicit rest declaration at the following note which inherits it', () => {
        const { score, settings } = load();
        const beats = score.tracks[0].staves[0].bars[0].voices[0].beats;
        beats[0].dynamics = DynamicValue.P;
        beats[1].dynamics = DynamicValue.PP;
        beats[1].isDynamicsExplicit = true;
        beats[2].dynamics = DynamicValue.PP;
        const effect = new DynamicsEffectInfo();
        expect(effect.shouldCreateGlyph(settings, beats[1])).toBe(true);
        expect(effect.shouldCreateGlyph(settings, beats[2])).toBe(false);
    });
    it('preserves the declaration flag through Worker serialization and cloning', () => {
        const { score } = load();
        const rest = score.tracks[0].staves[0].bars[0].voices[0].beats[1];
        rest.isDynamicsExplicit = true;
        const copy = JsonConverter.jsObjectToScore(JsonConverter.scoreToJsObject(score));
        expect(copy.tracks[0].staves[0].bars[0].voices[0].beats[1].isDynamicsExplicit).toBe(true);
        expect(BeatCloner.clone(rest).isDynamicsExplicit).toBe(true);
    });
});
