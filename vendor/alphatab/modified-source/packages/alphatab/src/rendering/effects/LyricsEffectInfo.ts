import type { Beat } from '@coderline/alphatab/model/Beat';
import { LyricPlacement } from '@coderline/alphatab/model/LyricElement';
import { NotationElement } from '@coderline/alphatab/NotationSettings';
import { TextAlign } from '@coderline/alphatab/platform/ICanvas';
import type { BarRendererBase } from '@coderline/alphatab/rendering/BarRendererBase';
import { EffectBarGlyphSizing } from '@coderline/alphatab/rendering/EffectBarGlyphSizing';
import { EffectInfo } from '@coderline/alphatab/rendering/EffectInfo';
import type { EffectGlyph } from '@coderline/alphatab/rendering/glyphs/EffectGlyph';
import { LyricsGlyph } from '@coderline/alphatab/rendering/glyphs/LyricsGlyph';
import type { Settings } from '@coderline/alphatab/Settings';

/**
 * @internal
 */
export class LyricsEffectInfo extends EffectInfo {
    public constructor(private readonly _placement: LyricPlacement = LyricPlacement.Below) {
        super();
    }

    public override get effectId(): string {
        return this._placement === LyricPlacement.Below ? super.effectId : `${super.effectId}.above`;
    }

    public get notationElement(): NotationElement {
        return NotationElement.EffectLyrics;
    }

    public get hideOnMultiTrack(): boolean {
        return false;
    }

    public get canShareBand(): boolean {
        return false;
    }

    public get sizingMode(): EffectBarGlyphSizing {
        return EffectBarGlyphSizing.SingleOnBeat;
    }

    public shouldCreateGlyph(_settings: Settings, beat: Beat): boolean {
        return LyricsGlyph.versesForPlacement(beat, this._placement).some(verse => {
            const element = beat.lyricElements?.[verse];
            return (
                !!beat.lyrics?.[verse] ||
                !!element?.extension ||
                !!element?.syllabic ||
                LyricsGlyph.extensionBefore(beat, verse) ||
                LyricsGlyph.syllableBefore(beat, verse)
            );
        });
    }

    public createNewGlyph(renderer: BarRendererBase, beat: Beat): EffectGlyph {
        const verses = LyricsGlyph.versesForPlacement(beat, this._placement);
        return new LyricsGlyph(
            0,
            0,
            verses.map(verse => beat.lyrics?.[verse] ?? ''),
            renderer.resources.elementFonts.get(NotationElement.EffectLyrics)!,
            TextAlign.Center,
            verses
        );
    }

    public canExpand(_from: Beat, _to: Beat): boolean {
        return true;
    }
}
