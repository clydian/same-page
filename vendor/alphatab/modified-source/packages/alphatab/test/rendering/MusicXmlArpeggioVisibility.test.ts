import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { source, load, midi } from '../audio/MusicXmlArpeggioFixtures';
import { Settings } from '@coderline/alphatab/Settings';
import { LayoutMode } from '@coderline/alphatab/LayoutMode';
import { StaveProfile } from '@coderline/alphatab/StaveProfile';
import { ScoreRenderer } from '@coderline/alphatab/rendering/ScoreRenderer';
import { NoteVibratoGlyph } from '@coderline/alphatab/rendering/glyphs/NoteVibratoGlyph';
import type { Score } from '@coderline/alphatab/model/Score';

// Independently frozen from the committed c177 source in a separate checkout.
// These hashes cover the complete MIDI events, all fields and timeline bounds.
const baseline: Record<string, { xml: string; midi: string }> = {
    first: {
        xml: 'cb109bfc16c9981e9f619f94e03702e9ca9a89a88ce50fdcf44f69037802baeb',
        midi: '939d919b925c6187120a4a797673836b20d304ba8fcc6672a241729ca68b2a6e'
    },
    extreme: {
        xml: '1727d50b44005aac709017cb5474ebc902727a64468c84b5f467933832e3c17d',
        midi: '939d919b925c6187120a4a797673836b20d304ba8fcc6672a241729ca68b2a6e'
    },
    'first-staff': {
        xml: '241e4ead547412aed1696b79a6eeb683b2429c78de42dd445244c4027bd8df91',
        midi: '7c49260e984dea5b58ca94bd65ce8268fb2be958681c455478e8fbb71d0e5494'
    },
    all: {
        xml: '8d731f479f7804096c60e9a36bd6669fabdef7480bacc8ec30d05b7a66328362',
        midi: 'fc06b983ebfd096df7138c7b39643a36a85cb21939bdd0c1b19f6240d565d88f'
    }
};
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

function spans(score: Score, mode: LayoutMode) {
    const settings = new Settings();
    settings.core.engine = 'svg';
    settings.core.enableLazyLoading = false;
    settings.display.staveProfile = StaveProfile.Score;
    settings.display.layoutMode = mode;
    const renderer = new ScoreRenderer(settings);
    renderer.width = 800;
    const result: number[] = [];
    const paint = NoteVibratoGlyph.prototype.paint;
    const spy = vi.spyOn(NoteVibratoGlyph.prototype, 'paint').mockImplementation(function (cx, cy, canvas) {
        result.push(this.width);
        paint.call(this, cx, cy, canvas);
    });
    renderer.error.on(error => {
        throw error;
    });
    try {
        renderer.renderScore(score, [0]);
        return result;
    } finally {
        spy.mockRestore();
        renderer.destroy();
    }
}
for (const mode of [LayoutMode.Page, LayoutMode.Horizontal]) {
    for (const kind of ['first', 'extreme', 'first-staff', 'all']) {
        it(`bounds authored waves by printed heads only, ${kind}, layout=${mode}`, () => {
            const original = source('', kind === 'first-staff');
            let index = 0;
            const xml = original.replaceAll(/<note>.*?<\/note>/g, note => {
                if (!note.includes('<pitch>')) {
                    return note;
                }
                const current = index++;
                return kind === 'all' || (kind === 'first-staff' ? current < 3 : current === (kind === 'first' ? 0 : 2))
                    ? note.replace('<note>', '<note print-object="no">')
                    : note;
            });
            const score = load(xml);
            const hidden = score.tracks[0].staves
                .flatMap(staff => staff.bars[0].voices.flatMap(voice => voice.beats.flatMap(beat => beat.notes)))
                .filter(note => !note.isVisible);
            expect(hidden).toHaveLength(kind === 'first-staff' || kind === 'all' ? 3 : 1);
            expect(hidden.every(note => note.sourceArpeggio !== null)).toBe(true);
            const before = midi(score);
            expect(hash(xml)).toBe(baseline[kind].xml);
            expect(hash(JSON.stringify(before))).toBe(baseline[kind].midi);
            // A partially hidden chord still sounds every authored member. Entirely
            // hidden voices have an existing empty-voice playback limitation; this
            // visual fix preserves their exact c177 playback, without endorsing it.
            if (kind === 'first' || kind === 'extreme') {
                expect(before).toEqual(midi(load(original)));
            }
            // Independent visual control removes only the hidden heads' authored sign
            // participation in XML; their pitch, duration and visibility stay identical.
            const visibleOnly = xml.replaceAll(/<note print-object="no">.*?<\/note>/g, note =>
                note.replaceAll(/<arpeggiate[^>]*\/>/g, '')
            );
            const actual = spans(score, mode);
            expect(actual).toEqual(spans(load(visibleOnly), mode));
            expect(actual).toHaveLength(kind === 'all' ? 0 : 1);
            expect(midi(score)).toEqual(before);
            expect(hidden.every(note => note.sourceArpeggio !== null)).toBe(true);
        });
    }
}
