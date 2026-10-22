import { SourceTextPlacement } from '@coderline/alphatab/model/Bar';
import type { Beat } from '@coderline/alphatab/model/Beat';
import { NotationElement } from '@coderline/alphatab/NotationSettings';
import type { BarRendererBase } from '@coderline/alphatab/rendering/BarRendererBase';
import { EffectBarGlyphSizing } from '@coderline/alphatab/rendering/EffectBarGlyphSizing';
import { EffectInfo } from '@coderline/alphatab/rendering/EffectInfo';
import { SourceTextsGlyph } from '@coderline/alphatab/rendering/glyphs/SourceTextsGlyph';
import type { Settings } from '@coderline/alphatab/Settings';

/** Independent authored directions; no musical beat is inserted or moved. @internal */
export class SourceTextsEffectInfo extends EffectInfo {
    public constructor(private readonly _placement = SourceTextPlacement.Above) {
        super();
    }
    public override get effectId(): string {
        return `${this.notationElement}.source.${this._placement}`;
    }
    public get notationElement(): NotationElement {
        return NotationElement.EffectText;
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
            (beat.voice.bar.sourceTexts?.some(
                t =>
                    (t.placement ?? SourceTextPlacement.Above) === this._placement &&
                    SourceTextsGlyph.isValid(t, beat.voice.bar.masterBar.calculateDuration())
            ) ??
                false)
        );
    }
    public createNewGlyph(_renderer: BarRendererBase, beat: Beat): SourceTextsGlyph {
        return new SourceTextsGlyph(
            beat.voice.bar.sourceTexts!.filter(
                t =>
                    (t.placement ?? SourceTextPlacement.Above) === this._placement &&
                    SourceTextsGlyph.isValid(t, beat.voice.bar.masterBar.calculateDuration())
            )
        );
    }
    public canExpand(_from: Beat, _to: Beat): boolean {
        return false;
    }
}
