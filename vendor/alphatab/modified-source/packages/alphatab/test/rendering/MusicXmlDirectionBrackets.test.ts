import { MusicXmlImporter } from '@coderline/alphatab/importer/MusicXmlImporter';
import { ByteBuffer } from '@coderline/alphatab/io/ByteBuffer';
import { LayoutMode } from '@coderline/alphatab/LayoutMode';
import { JsonConverter } from '@coderline/alphatab/model/JsonConverter';
import { ScoreRenderer } from '@coderline/alphatab/rendering/ScoreRenderer';
import { Settings } from '@coderline/alphatab/Settings';
import { StaveProfile } from '@coderline/alphatab/StaveProfile';
import { describe, expect, it } from 'vitest';

// Owned notes and modern direction graphics; no copyright score is embedded.
const owned = `<?xml version='1.0' encoding='utf-8'?>
<score-partwise version="4.0">
  <part-list>
    <score-part id="P1">
      <part-name>Tenor</part-name>
    </score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>4</divisions>
        <time>
          <beats>4</beats>
          <beat-type>4</beat-type>
        </time>
        <clef>
          <sign>G</sign>
          <line>2</line>
          <clef-octave-change>-1</clef-octave-change>
        </clef>
      </attributes>
      <direction placement="above">
        <direction-type>
          <bracket type="start" number="1" line-type="solid" line-end="down" default-y="10" end-length="65"/>
        </direction-type>
        <offset>0</offset>
      </direction>
      <direction placement="above">
        <direction-type>
          <bracket type="stop" number="1" line-type="solid" line-end="down" default-y="10" end-length="65"/>
        </direction-type>
        <offset>8</offset>
      </direction>
      <direction placement="above">
        <direction-type>
          <bracket type="start" number="2" line-type="solid" line-end="none" default-y="-55"/>
        </direction-type>
        <offset>0</offset>
      </direction>
      <direction placement="above">
        <direction-type>
          <bracket type="stop" number="2" line-type="solid" line-end="none" default-y="-55"/>
        </direction-type>
        <offset>8</offset>
      </direction>
      <direction placement="above">
        <direction-type>
          <bracket type="start" number="3" line-type="wavy" line-end="none" default-y="-20"/>
        </direction-type>
        <offset>8</offset>
      </direction>
      <note>
        <pitch>
          <step>D</step>
          <octave>3</octave>
        </pitch>
        <duration>4</duration>
        <type>quarter</type>
        <stem>none</stem>
      </note>
      <note>
        <pitch>
          <step>E</step>
          <octave>3</octave>
        </pitch>
        <duration>4</duration>
        <type>quarter</type>
        <stem>none</stem>
      </note>
      <note>
        <pitch>
          <step>B</step>
          <octave>3</octave>
        </pitch>
        <duration>4</duration>
        <type>quarter</type>
        <stem>none</stem>
      </note>
      <note>
        <pitch>
          <step>A</step>
          <octave>3</octave>
        </pitch>
        <duration>4</duration>
        <type>quarter</type>
        <stem>none</stem>
      </note>
    </measure>
    <measure number="2">
      <direction placement="above">
        <direction-type>
          <bracket type="stop" number="3" line-type="wavy" line-end="none" default-y="-20"/>
        </direction-type>
        <offset>16</offset>
      </direction>
      <note>
        <pitch>
          <step>D</step>
          <octave>3</octave>
        </pitch>
        <duration>4</duration>
        <type>quarter</type>
        <stem>none</stem>
      </note>
      <note>
        <pitch>
          <step>B</step>
          <octave>3</octave>
        </pitch>
        <duration>4</duration>
        <type>quarter</type>
        <stem>none</stem>
      </note>
      <note>
        <pitch>
          <step>G</step>
          <octave>3</octave>
        </pitch>
        <duration>4</duration>
        <type>quarter</type>
        <stem>none</stem>
      </note>
      <note>
        <pitch>
          <step>E</step>
          <octave>3</octave>
        </pitch>
        <duration>4</duration>
        <type>quarter</type>
        <stem>none</stem>
      </note>
    </measure>
  </part>
</score-partwise>
`;
function load(xml = owned) {
    const settings = new Settings();
    const importer = new MusicXmlImporter();
    importer.init(ByteBuffer.fromBuffer(new TextEncoder().encode(xml)), settings);
    return importer.readScore();
}
function render(xml = owned, horizontal = false, throughJson = true, barsPerRow = -1) {
    const settings = new Settings();
    settings.core.engine = 'svg';
    settings.core.enableLazyLoading = false;
    settings.display.staveProfile = StaveProfile.Score;
    settings.display.barsPerRow = barsPerRow;
    if (horizontal) {
        settings.display.layoutMode = LayoutMode.Horizontal;
    }
    let score = load(xml);
    if (throughJson) {
        score = JsonConverter.jsObjectToScore(JsonConverter.scoreToJsObject(score));
    }
    const renderer = new ScoreRenderer(settings),
        svg: string[] = [],
        errors: unknown[] = [];
    renderer.width = 900;
    renderer.partialRenderFinished.on(event => {
        if (typeof event.renderResult === 'string') {
            svg.push(event.renderResult);
        }
    });
    renderer.error.on(error => errors.push(error));
    try {
        renderer.renderScore(score, [0]);
    } finally {
        renderer.destroy();
    }
    expect(errors).toEqual([]);
    return svg;
}
const without = owned.replace(/<direction[\s\S]*?<\/direction>/g, '');

describe('MusicXML display-only direction brackets', () => {
    it('retains finite brackets and splits one cross-bar wave into staff-local segments', () => {
        const score = load();
        const bars = score.tracks[0].staves[0].bars;
        const first = bars[0].sourceBrackets!;
        const second = bars[1].sourceBrackets!;
        expect(first).toHaveLength(3);
        expect(second).toHaveLength(1);
        expect(first[0]).toMatchObject({
            displayStart: 0,
            displayEnd: 1920,
            startY: 10,
            endY: 10,
            lineType: 'solid',
            startLineEnd: 'down',
            endLineEnd: 'down',
            isStart: true,
            isEnd: true
        });
        expect(first[2]).toMatchObject({
            displayStart: 1920,
            displayEnd: 3840,
            lineType: 'wavy',
            isStart: true,
            isEnd: false
        });
        expect(second[0]).toMatchObject({
            displayStart: 0,
            displayEnd: 3840,
            lineType: 'wavy',
            isStart: false,
            isEnd: true
        });
        expect(first[2].sourceId).toEqual(second[0].sourceId);
    });
    for (const horizontal of [false, true]) {
        it(`draws the source frame and wave after Worker JSON (${horizontal ? 'Horizontal' : 'Page'})`, () => {
            expect(render()).toEqual(render(owned, false, false));
            expect(render(owned, horizontal)).not.toEqual(render(without, horizontal));
        });
    }
    it('round-trips public segments and keeps legacy missing fields empty', () => {
        const source = load();
        const copy = JsonConverter.jsObjectToScore(JsonConverter.scoreToJsObject(source));
        expect(Reflect.get(copy.tracks[0].staves[0].bars[0], 'sourceBrackets')).toEqual(
            Reflect.get(source.tracks[0].staves[0].bars[0], 'sourceBrackets')
        );
        expect(Reflect.get(load(without).tracks[0].staves[0].bars[0], 'sourceBrackets')).toBeNull();
    });
    it('does not create display spans from unmatched endpoints', () => {
        const bad = owned.replace(/<bracket type="stop"[^>]*\/>/g, '');
        expect(Reflect.get(load(bad).tracks[0].staves[0].bars[0], 'sourceBrackets') ?? []).toHaveLength(0);
    });
    it('closes an endpoint at the following bar start on the last nonempty segment', () => {
        const xml = owned.replace('<offset>16</offset>', '<offset>0</offset>');
        const bars = load(xml).tracks[0].staves[0].bars;
        expect(bars[0].sourceBrackets![2]).toMatchObject({
            displayStart: 1920,
            displayEnd: 3840,
            isStart: true,
            isEnd: true
        });
        expect(bars[1].sourceBrackets).toBeNull();
    });
    it('keeps negative direction offsets after a forward at the authored musical position', () => {
        const xml = without.replace(
            '<note>',
            `<forward><duration>8</duration></forward>
            <direction><direction-type><bracket type="start" number="1" line-end="none"/></direction-type><offset>-7</offset></direction>
            <direction><direction-type><bracket type="stop" number="1" line-end="none"/></direction-type><offset>-3</offset></direction>
            <backup><duration>8</duration></backup><note>`
        );
        expect(load(xml).tracks[0].staves[0].bars[0].sourceBrackets![0]).toMatchObject({
            displayStart: 240,
            displayEnd: 1200
        });
    });
    it('does not fabricate a complete span across an unsupported continue waypoint', () => {
        const xml = owned.replace('<bracket type="stop" number="1"', '<bracket type="continue" number="1"');
        expect(load(xml).tracks[0].staves[0].bars[0].sourceBrackets).toHaveLength(2);
    });
    it('retains a zero-offset frame after fractional tuplet cursor accumulation', () => {
        const notes = Array.from(
            { length: 9 },
            () =>
                '<note><pitch><step>D</step><octave>3</octave></pitch><duration>4</duration><type>quarter</type><time-modification><actual-notes>9</actual-notes><normal-notes>4</normal-notes></time-modification></note>'
        ).join('');
        const xml =
            '<score-partwise><part-list><score-part id="P"><part-name>Tenor</part-name></score-part></part-list><part id="P"><measure number="1"><attributes><divisions>9</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>' +
            notes +
            '<direction><direction-type><bracket type="start" number="1" line-end="none"/></direction-type><offset>-36</offset></direction>' +
            '<direction><direction-type><bracket type="stop" number="1" line-end="none"/></direction-type><offset>-4</offset></direction></measure></part></score-partwise>';
        expect(load(xml).tracks[0].staves[0].bars[0].sourceBrackets![0]).toMatchObject({ displayStart: 0 });
    });
    it('draws separate finite segments after a forced system break without changing legacy fallback', () => {
        const lines = render(owned, false, true, 1);
        expect(lines).not.toEqual(render(without, false, true, 1));
        expect(lines).toEqual(render(owned, false, false, 1));
        expect(lines.join('')).not.toMatch(/NaN|Infinity/);
        const waves = (pieces: string[]) =>
            [...pieces.join('').matchAll(/<path d="([^"]+)"/g)].filter(
                match => (match[1].match(/ L/g)?.length ?? 0) > 12
            );
        expect(waves(render(owned))).toHaveLength(1); // Joined inside one visible system.
        expect(waves(lines)).toHaveLength(2); // One bounded fragment per separate system.
    });
    it('does not draw unsupported line styles or nonfinite public positions', () => {
        const unsupported = owned
            .replaceAll('line-type="solid"', 'line-type="dashed"')
            .replaceAll('line-type="wavy"', 'line-type="dotted"');
        expect(render(unsupported)).toEqual(render(without));
        const invalid = owned
            .replaceAll('default-y="10"', 'default-y="NaN"')
            .replaceAll('default-y="-55"', 'default-y="NaN"')
            .replaceAll('default-y="-20"', 'default-y="NaN"');
        expect(render(invalid)).toEqual(render(without));
    });

    it('does not join matching numbers across different staves', () => {
        const xml = owned
            .replace('<clef>', '<staves>2</staves><clef>')
            .replace(
                /(<direction[^>]*>\s*<direction-type>\s*<bracket type="stop" number="1"[\s\S]*?<offset>8<\/offset>)/,
                '$1<staff>2</staff>'
            );
        const staves = load(xml).tracks[0].staves;
        expect(staves[0].bars[0].sourceBrackets).toHaveLength(2);
        expect(staves[1].bars[0].sourceBrackets).toBeNull();
    });
    it('does not silently overwrite a still-open number with another start', () => {
        const xml = owned.replace('<bracket type="stop" number="1"', '<bracket type="start" number="1"');
        expect(load(xml).tracks[0].staves[0].bars[0].sourceBrackets).toHaveLength(2);
    });
    for (const attribute of ['color="#FF0000"', 'rotation="30"', 'print-object="no"', 'dash-length="8"']) {
        it(`rejects complete spans with unsupported bracket formatting: ${attribute}`, () => {
            const xml = owned.replaceAll('<bracket ', `<bracket ${attribute} `);
            expect(render(xml)).toEqual(render(without));
            expect(load(xml).tracks[0].staves[0].bars.every(bar => !bar.sourceBrackets?.length)).toBe(true);
        });
    }
    it('rejects the whole span when only its stop requests unsupported color', () => {
        const xml = owned.replace('<bracket type="stop" number="1"', '<bracket color="#FF0000" type="stop" number="1"');
        expect(load(xml).tracks[0].staves[0].bars[0].sourceBrackets).toHaveLength(2);
    });
    it('does not draw a hidden nonstandard direction as visible default ink', () => {
        const xml = owned.replaceAll('<direction placement=', '<direction print-object="no" placement=');
        expect(render(xml)).toEqual(render(without));
    });
    it('keeps two complete same-number spans independent on two staves', () => {
        const attributes =
            '<attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>';
        const pair = (staff: number) =>
            `<direction><direction-type><bracket type="start" number="1" line-end="none"/></direction-type><offset>0</offset><staff>${staff}</staff></direction><direction><direction-type><bracket type="stop" number="1" line-end="none"/></direction-type><offset>8</offset><staff>${staff}</staff></direction>`;
        const xml = `<score-partwise><part-list><score-part id="P"><part-name>Piano</part-name></score-part></part-list><part id="P"><measure number="1">${attributes}${pair(1)}${pair(2)}<note><rest measure="yes"/><duration>16</duration><staff>1</staff></note><backup><duration>16</duration></backup><note><rest measure="yes"/><duration>16</duration><staff>2</staff></note></measure></part></score-partwise>`;
        const staves = load(xml).tracks[0].staves;
        expect(staves[0].bars[0].sourceBrackets).toHaveLength(1);
        expect(staves[1].bars[0].sourceBrackets).toHaveLength(1);
        expect(staves[0].bars[0].sourceBrackets![0].sourceId).not.toBe(staves[1].bars[0].sourceBrackets![0].sourceId);
    });
    it('does not default-paint unknown formatting on the bracket direction-type container', () => {
        const xml = owned.replaceAll('<direction-type>', '<direction-type print-object="no">');
        expect(render(xml)).toEqual(render(without));
    });
    for (const raw of ['20foo', '1e2', '0x20', '', 'Infinity']) {
        it(`rejects a non-decimal numeric attribute instead of parsing a prefix: ${raw}`, () => {
            const xml = owned.replace('default-y="10"', `default-y="${raw}"`);
            expect(load(xml).tracks[0].staves[0].bars[0].sourceBrackets).toHaveLength(2);
        });
    }
    it('accepts complete signed decimal forms without truncation', () => {
        const xml = owned.replace('default-y="10"', 'default-y=" +.5 "');
        expect(load(xml).tracks[0].staves[0].bars[0].sourceBrackets![0].startY).toBe(0.5);
    });
});
