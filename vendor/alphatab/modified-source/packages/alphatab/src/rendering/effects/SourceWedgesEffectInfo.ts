import { LayoutMode } from '@coderline/alphatab/LayoutMode';
import { SourceWedgePlacement } from '@coderline/alphatab/model/Bar';
import type { Beat } from '@coderline/alphatab/model/Beat';
import { NotationElement } from '@coderline/alphatab/NotationSettings';
import type { BarRendererBase } from '@coderline/alphatab/rendering/BarRendererBase';
import { EffectBarGlyphSizing } from '@coderline/alphatab/rendering/EffectBarGlyphSizing';
import { EffectInfo } from '@coderline/alphatab/rendering/EffectInfo';
import type { EffectGlyph } from '@coderline/alphatab/rendering/glyphs/EffectGlyph';
import { SourceWedgesGlyph } from '@coderline/alphatab/rendering/glyphs/SourceWedgesGlyph';
import type { Settings } from '@coderline/alphatab/Settings';

/** An independent staff-level source span band, not a playback voice. @internal */
export class SourceWedgesEffectInfo extends EffectInfo {
    public constructor(private readonly _placement = SourceWedgePlacement.Below) {
        super();
    }
    public override get effectId(): string {
        return `${this.notationElement}.source.${this._placement}`;
    }
    public get notationElement(): NotationElement {
        return NotationElement.EffectCrescendo;
    }
    public get hideOnMultiTrack(): boolean {
        return false;
    }
    public get canShareBand(): boolean {
        return false;
    }
    public get sizingMode(): EffectBarGlyphSizing {
        return EffectBarGlyphSizing.FullBar;
    }
    public shouldCreateGlyph(_settings: Settings, beat: Beat): boolean {
        return (
            beat.voice.index === 0 &&
            beat.index === 0 &&
            (beat.voice.bar.sourceWedges?.some(
                w =>
                    (w.placement ?? SourceWedgePlacement.Below) === this._placement &&
                    SourceWedgesGlyph.isValid(w, beat.voice.bar.masterBar.calculateDuration())
            ) ??
                false)
        );
    }
    public createNewGlyph(renderer: BarRendererBase, beat: Beat): EffectGlyph {
        // Horizontal SVG partials must own the complete joined shape, just as
        // native grouped effects do. Vertical system breaking remains unchanged.
        if (
            renderer.settings.display.layoutMode === LayoutMode.Horizontal &&
            beat.voice.bar.sourceWedges?.some(
                w =>
                    (w.placement ?? SourceWedgePlacement.Below) === this._placement &&
                    SourceWedgesGlyph.findContinuation(renderer, w, true)
            )
        ) {
            renderer.isLinkedToPrevious = true;
        }
        return new SourceWedgesGlyph(
            beat.voice.bar.sourceWedges!.filter(
                w =>
                    (w.placement ?? SourceWedgePlacement.Below) === this._placement &&
                    SourceWedgesGlyph.isValid(w, beat.voice.bar.masterBar.calculateDuration())
            )
        );
    }
    public canExpand(_from: Beat, _to: Beat): boolean {
        return false;
    }
}
