import { MusicXmlImporter } from '@coderline/alphatab/importer/MusicXmlImporter';
import { ByteBuffer } from '@coderline/alphatab/io/ByteBuffer';
import { JsonConverter } from '@coderline/alphatab/model/JsonConverter';
import { ScoreRenderer } from '@coderline/alphatab/rendering/ScoreRenderer';
import { BeatCloner } from '@coderline/alphatab/generated/model/BeatCloner';
import { Settings } from '@coderline/alphatab/Settings';
import { describe, expect, it } from 'vitest';

const note = (step: string, octave: number, staff: number, beam: string, voice = 1) =>
    `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>1</duration><voice>${voice}</voice><type>16th</type><stem>down</stem><staff>${staff}</staff><beam number="1">${beam}</beam><beam number="2">${beam}</beam></note>`;
function source(cross = true, split = false, otherVoice = false) {
    return `<score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>4</divisions><time><beats>1</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>${note('C', 3, cross ? 2 : 1, 'begin')}${note('G', 3, cross ? 2 : 1, split || otherVoice ? 'end' : 'continue')}${note('C', 4, 1, split || otherVoice ? 'begin' : 'continue', otherVoice ? 2 : 1)}${note('E', 4, 1, 'end', otherVoice ? 2 : 1)}</measure></part></score-partwise>`;
}
function load(xml: string) {
    const importer = new MusicXmlImporter();
    importer.init(ByteBuffer.fromBuffer(new TextEncoder().encode(xml)), new Settings());
    return importer.readScore();
}
function render(xml: string, barsPerRow = -1) {
    const settings = new Settings();
    settings.core.engine = 'svg';
    settings.core.enableLazyLoading = false;
    settings.display.barsPerRow = barsPerRow;
    const score = load(xml);
    const renderer = new ScoreRenderer(settings);
    renderer.width = 800;
    let svg = '';
    const pieces: string[] = [];
    renderer.partialRenderFinished.on(event => {
        if (typeof event.renderResult === 'string') {
            svg += event.renderResult;
            if (event.renderResult.includes('d="')) {
                pieces.push(event.renderResult);
            }
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
    const spans = [...svg.matchAll(/<path[^>]+d="([^"]+)"[^>]*>/g)]
        .filter(m => /L/.test(m[1]))
        .map(m => {
            const xs = [...m[1].matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)].map(v => Number(v[1]));
            return [Math.min(...xs), Math.max(...xs)];
        });
    return { score, pieces, spans: spans.sort((a, b) => a[0] - b[0]) };
}
function gaps(spans: number[][]) {
    let end = spans[0][1];
    const result: number[][] = [];
    for (const [a, b] of spans.slice(1)) {
        if (a > end + 0.1) {
            result.push([end, a]);
        }
        end = Math.max(end, b);
    }
    return result;
}
describe('explicit MusicXML cross-staff beams', () => {
    it('connects the staff-change interval of one logical source beam group', () => {
        expect(gaps(render(source()).spans)).toEqual([]);
    });
    it('retains same-staff legacy beam geometry', () => {
        expect(gaps(render(source(false)).spans)).toEqual([]);
    });
    it('does not connect a different logical source voice', () => {
        expect(gaps(render(source(true, false, true)).spans)).toHaveLength(1);
    });
    it('retains explicit group boundaries', () => {
        expect(gaps(render(source(false, true)).spans)).toHaveLength(1);
    });
    it('retains the source group identity through public Worker JSON', () => {
        const score = load(source());
        const json = JsonConverter.scoreToJson(score);
        const copy = JsonConverter.jsObjectToScore(JSON.parse(json));
        expect(JsonConverter.scoreToJson(copy)).toBe(json);
        const ids = copy.tracks[0].staves.flatMap(s =>
            s.bars[0].voices.flatMap(v => v.beats.filter(b => !b.isEmpty).map(b => Reflect.get(b, 'sourceBeamGroup')))
        );
        expect(ids).toHaveLength(4);
        expect(new Set(ids).size).toBe(1);
        expect(ids[0]).toBeGreaterThan(0);
    });
    it('does not reconnect the returning staff across two complete source groups', () => {
        const original = source();
        const first = original.match(/<note>[\s\S]*<\/note>/)![0];
        const xml = original
            .replace(
                '</measure>',
                `${first
                    .replaceAll('<step>C</step>', '<step>D</step>')
                    .replaceAll('<step>G</step>', '<step>A</step>')
                    .replaceAll('<step>E</step>', '<step>F</step>')}</measure>`
            )
            .replace('<beats>1</beats>', '<beats>2</beats>');
        const { score, spans } = render(xml);
        const groups = new Map<number, number>();
        for (const staff of score.tracks[0].staves) {
            for (const beat of staff.bars[0].voices[0].beats) {
                if (beat.sourceBeamGroup) {
                    groups.set(beat.sourceBeamGroup, (groups.get(beat.sourceBeamGroup) ?? 0) + 1);
                }
            }
        }
        expect([...groups.values()]).toEqual([4, 4]);
        expect(gaps(spans)).toHaveLength(1);
    });
    it('retains group metadata in native clones and defaults old JSON to legacy', () => {
        const beat = load(source()).tracks[0].staves[1].bars[0].voices[0].beats[0];
        expect(BeatCloner.clone(beat).sourceBeamGroup).toBe(beat.sourceBeamGroup);
        const old = JSON.parse(JsonConverter.scoreToJson(load(source())));
        for (const t of old.tracks) {
            for (const s of t.staves) {
                for (const b of s.bars) {
                    for (const v of b.voices) {
                        for (const be of v.beats) {
                            delete be.sourcebeamgroup;
                        }
                    }
                }
            }
        }
        expect(JsonConverter.jsObjectToScore(old).tracks[0].staves[1].bars[0].voices[0].beats[0].sourceBeamGroup).toBe(
            0
        );
    });
    it.each(['down', 'up'])('keeps both system segments local for explicit %s stems', stem => {
        const xml = source()
            .replaceAll('<stem>down</stem>', `<stem>${stem}</stem>`)
            .replace('<beats>1</beats><beat-type>4</beat-type>', '<beats>1</beats><beat-type>8</beat-type>')
            .replace(
                /(<staff>2<\/staff><beam number="1">continue<\/beam><beam number="2">continue<\/beam><\/note>)/,
                '$1</measure><measure number="2"><print new-system="yes"/>'
            );
        const { score, pieces } = render(xml, 1);
        expect(
            new Set(
                score.tracks[0].staves.flatMap(s =>
                    s.bars.flatMap(b =>
                        b.voices.flatMap(v => v.beats.filter(b => b.sourceBeamGroup).map(b => b.sourceBeamGroup))
                    )
                )
            ).size
        ).toBe(1);
        expect(pieces).toHaveLength(2);
        for (const svg of pieces) {
            const paths = [...svg.matchAll(/<path[^>]+d="([^"]+)"[^>]*>/g)].filter(m => /L/.test(m[1]));
            expect(paths).toHaveLength(2);
            const width = Number(svg.match(/width="([\d.]+)/)![1]);
            const height = Number(svg.match(/height="([\d.]+)/)![1]);
            for (const path of paths) {
                for (const xy of path[1].matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)) {
                    expect(Number(xy[1])).toBeGreaterThanOrEqual(0);
                    expect(Number(xy[1])).toBeLessThanOrEqual(width);
                    expect(Number(xy[2])).toBeGreaterThanOrEqual(0);
                    expect(Number(xy[2])).toBeLessThanOrEqual(height);
                }
            }
        }
    });
    it.each([
        'hook',
        'incomplete',
        'mixedStem',
        'noncontiguous'
    ])('keeps unsupported %s input on its existing staff-local path', kind => {
        let xml = source();
        if (kind === 'hook') {
            xml = xml.replace('<beam number="2">continue</beam>', '<beam number="2">forward hook</beam>');
        }
        if (kind === 'incomplete') {
            xml = xml.replaceAll('<beam number="1">end</beam>', '<beam number="1">continue</beam>');
        }
        if (kind === 'mixedStem') {
            xml = xml.replace('<stem>down</stem>', '<stem>up</stem>');
        }
        if (kind === 'noncontiguous') {
            xml = xml.replace('</note><note>', '</note><forward><duration>1</duration></forward><note>');
        }
        expect(
            load(xml)
                .tracks[0].staves.flatMap(s => s.bars.flatMap(b => b.voices.flatMap(v => v.beats)))
                .every(b => b.sourceBeamGroup === 0)
        ).toBe(true);
    });
});
