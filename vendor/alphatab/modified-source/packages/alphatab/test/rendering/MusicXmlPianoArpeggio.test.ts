import { expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { source, load } from '../audio/MusicXmlArpeggioFixtures';
import { Settings } from '@coderline/alphatab/Settings';
import { LayoutMode } from '@coderline/alphatab/LayoutMode';
import { StaveProfile } from '@coderline/alphatab/StaveProfile';
import { ScoreRenderer } from '@coderline/alphatab/rendering/ScoreRenderer';
import { SourceArpeggioGlyph } from '@coderline/alphatab/rendering/glyphs/SourceArpeggioGlyph';
import { NoteVibratoGlyph } from '@coderline/alphatab/rendering/glyphs/NoteVibratoGlyph';
for (const layout of [LayoutMode.Page, LayoutMode.Horizontal]) {
    for (const direction of ['', 'up', 'down']) {
        for (const unbroken of ['', 'yes', 'no']) {
            it(`paints one continuous authored wave with only explicit arrows, layout=${layout}, direction=${direction || 'none'}, unbroken=${unbroken || 'omitted'}`, () => {
                const settings = new Settings();
                settings.core.engine = 'svg';
                settings.core.enableLazyLoading = false;
                settings.display.staveProfile = StaveProfile.Score;
                settings.display.layoutMode = layout;
                const renderer = new ScoreRenderer(settings);
                renderer.width = 800;
                let svg = '';
                let arrows = 0;
                const spans: number[] = [];
                const paint = SourceArpeggioGlyph.prototype.paint;
                const spy = vi
                    .spyOn(SourceArpeggioGlyph.prototype, 'paint')
                    .mockImplementation(function (cx, cy, canvas) {
                        const fill = vi.spyOn(canvas, 'fill');
                        try {
                            paint.call(this, cx, cy, canvas);
                            arrows += fill.mock.calls.length;
                        } finally {
                            fill.mockRestore();
                        }
                    });
                const wave = NoteVibratoGlyph.prototype.paint;
                const waveSpy = vi
                    .spyOn(NoteVibratoGlyph.prototype, 'paint')
                    .mockImplementation(function (cx, cy, canvas) {
                        spans.push(this.width);
                        wave.call(this, cx, cy, canvas);
                    });
                renderer.partialRenderFinished.on(e => {
                    if (typeof e.renderResult === 'string') {
                        svg += e.renderResult;
                    }
                });
                renderer.error.on(e => {
                    throw e;
                });
                try {
                    renderer.renderScore(
                        load(
                            source(direction, true).replaceAll(
                                '<arpeggiate ',
                                `<arpeggiate ${unbroken ? `unbroken="${unbroken}"` : ''} `
                            )
                        ),
                        [0]
                    );
                    expect(svg).toContain('<svg');
                    expect(spans).toHaveLength(unbroken === 'no' ? 2 : 1);
                    expect(spans[0]).toBeGreaterThan(unbroken === 'no' ? 10 : 60);
                    expect(arrows).toBe(direction ? (unbroken === 'no' ? 2 : 1) : 0);
                    mkdirSync('/tmp/samepage-arpeggio-visual', { recursive: true });
                    writeFileSync(
                        `/tmp/samepage-arpeggio-visual/${layout}-${direction || 'none'}-${unbroken || 'omitted'}.svg`,
                        svg
                    );
                } finally {
                    spy.mockRestore();
                    waveSpy.mockRestore();
                    renderer.destroy();
                }
            });
        }
    }
}
