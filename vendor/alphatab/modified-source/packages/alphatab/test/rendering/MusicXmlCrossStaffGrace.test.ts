import { readFileSync } from 'node:fs';
import { LayoutMode } from '@coderline/alphatab/LayoutMode';
import { NoteOnEvent } from '@coderline/alphatab/midi/MidiEvent';
import { Duration } from '@coderline/alphatab/model/Duration';
import { GraceType } from '@coderline/alphatab/model/GraceType';
import { MusicFontSymbol } from '@coderline/alphatab/model/MusicFontSymbol';
import { JsonConverter } from '@coderline/alphatab/model/JsonConverter';
import type { Score } from '@coderline/alphatab/model/Score';
import { ScoreRenderer } from '@coderline/alphatab/rendering/ScoreRenderer';
import { Settings } from '@coderline/alphatab/Settings';
import { StaveProfile } from '@coderline/alphatab/StaveProfile';
import { expect, it } from 'vitest';
import { load, midi } from '../audio/MusicXmlArpeggioFixtures';

const source = readFileSync('test-data/musicxml4/cross-staff-grace.xml', 'utf-8');
const pitchOrder = [52, 53, 57, 62, 64, 65, 69, 72, 74, 77];
const graceNotes = (score: Score) =>
    score.tracks[0].staves.flatMap(staff =>
        staff.bars[0].voices.flatMap(voice => voice.beats.filter(beat => beat.graceType !== GraceType.None))
    );

it.each([true, false])('plays a single ten-note sequence with slash=%s after the Worker round trip', slash => {
    const score = load(slash ? source : source.replaceAll(' slash="yes"', ''));
    const json = JsonConverter.scoreToJson(score);
    const copy = JsonConverter.jsonToScore(json);
    const beats = graceNotes(copy).sort((a, b) => a.graceIndex - b.graceIndex);
    expect(beats.map(beat => beat.graceIndex)).toEqual(pitchOrder.map((_, i) => i));
    expect(new Set(beats.map(beat => beat.graceGroup)).size).toBe(1);
    expect(beats.map(beat => beat.voice.bar.staff.index)).toEqual([1, 1, 1, 1, 0, 0, 0, 0, 0, 0]);
    expect(beats.every(beat => beat.duration === Duration.Eighth && beat.displayDuration === 0)).toBe(true);
    expect(JsonConverter.scoreToJson(copy)).toBe(json);
    const playback = midi(copy);
    const notes = playback.events.filter((event): event is NoteOnEvent => event instanceof NoteOnEvent);
    expect(notes.map(note => note.noteKey)).toEqual([71, 41, ...pitchOrder, 79]);
    const graceStart = slash ? 2580 : 2880;
    expect(notes.slice(2, -1).map(note => note.tick)).toEqual(pitchOrder.map((_, i) => graceStart + 30 * i));
    expect(notes[notes.length - 1].tick).toBe(slash ? 2880 : 3180);
    expect(playback.off.map(({ noteKey, tick }) => [noteKey, tick])).toEqual(
        [[41, 3840], ...pitchOrder.map((key, i) => [key, graceStart + 30 * (i + 1)]), [71, 3840], [79, 3840]]
            .sort((a, b) => a[0] - b[0])
    );
    expect(playback.bounds).toEqual([[0, 3840]]);
});

it.each([LayoutMode.Page, LayoutMode.Horizontal])('draws one authored cross-staff beam in layout %s', mode => {
    const score = JsonConverter.jsonToScore(JsonConverter.scoreToJson(load(source)));
    const settings = new Settings();
    settings.core.engine = 'svg';
    settings.core.enableLazyLoading = false;
    settings.display.staveProfile = StaveProfile.Score;
    settings.display.layoutMode = mode;
    const renderer = new ScoreRenderer(settings);
    renderer.width = 760;
    let svg = '';
    renderer.partialRenderFinished.on(piece => {
        if (typeof piece.renderResult === 'string' && piece.firstMasterBarIndex >= 0) {
            svg += piece.renderResult;
        }
    });
    renderer.error.on(error => {
        throw error;
    });
    try {
        renderer.renderScore(score, [0]);
        expect(svg).toContain('<svg');
        const beams = [...svg.matchAll(/<path[^>]+d="([^"]+)"[^>]*>/g)].map(match => match[1])
            .filter(path => /^M[-\d.,]+ L[-\d.,]+ L[-\d.,]+ L[-\d.,]+ z$/.test(path.trim()));
        expect(beams).toHaveLength(1);
        expect(svg.match(new RegExp(`&#${MusicFontSymbol.GraceNoteSlashStemDown};`, 'g'))).toHaveLength(1);
        const graceXs = [...svg.matchAll(
            /<g transform="translate\(([\d.]+) [^)]+\)" class="at" ><text style="font-size: 75%; stroke:none"[^>]*>&#57508;/g
        )].map(match => Number(match[1]));
        expect(graceXs).toHaveLength(10);
        const sourceOrder = [...graceXs.slice(-4), ...graceXs.slice(0, 6)];
        expect(sourceOrder).toEqual([...sourceOrder].sort((a, b) => a - b));
        expect(new Set(sourceOrder).size).toBe(10);
    } finally {
        renderer.destroy();
    }
});

it('keeps a conventional single-staff before-beat group on the legacy path', () => {
    const score = load(source.replaceAll('<staff>2</staff>', '<staff>1</staff>'));
    const beats = graceNotes(score);
    expect(beats).toHaveLength(10);
    expect(beats.every(beat => !beat.sourceBeamGroup && beat.duration === Duration.ThirtySecond)).toBe(true);
    const notes = midi(score).events.filter((event): event is NoteOnEvent => event instanceof NoteOnEvent);
    expect(notes.slice(2).map(note => [note.noteKey, note.tick])).toEqual([
        ...pitchOrder.map((pitch, index) => [pitch, 2580 + index * 30]),
        [79, 2880]
    ]);
});

it('shortens only the preceding sounding note in the same logical voice', () => {
    const withDonor = source.replace('<rest/>', '<pitch><step>C</step><octave>3</octave></pitch>');
    const events = midi(load(withDonor));
    expect(events.on.find(note => note.noteKey === 48)?.tick).toBe(0);
    expect(events.off.find(note => note.noteKey === 48)?.tick).toBe(2580);
    for (const noteKey of [41, 71]) {
        expect(events.on.find(note => note.noteKey === noteKey)?.tick).toBe(0);
        expect(events.off.find(note => note.noteKey === noteKey)?.tick).toBe(3840);
    }
});
