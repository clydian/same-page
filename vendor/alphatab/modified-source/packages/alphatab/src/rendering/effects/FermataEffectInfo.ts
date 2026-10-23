import type { Beat } from '@coderline/alphatab/model/Beat';
import { NotationElement } from '@coderline/alphatab/NotationSettings';
import type { BarRendererBase } from '@coderline/alphatab/rendering/BarRendererBase';
import { EffectBarGlyphSizing } from '@coderline/alphatab/rendering/EffectBarGlyphSizing';
import { EffectInfo } from '@coderline/alphatab/rendering/EffectInfo';
import type { EffectGlyph } from '@coderline/alphatab/rendering/glyphs/EffectGlyph';
import { FermataGlyph } from '@coderline/alphatab/rendering/glyphs/FermataGlyph';
import type { Settings } from '@coderline/alphatab/Settings';

/**
 * @internal
 */
export class FermataEffectInfo extends EffectInfo {
    public constructor(private readonly _belowStaff: boolean = false) {
        super();
    }

    public override get effectId(): string {
        return this._belowStaff ? `${super.effectId}-below` : super.effectId;
    }

    public get notationElement(): NotationElement {
        return NotationElement.EffectFermata;
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
        return (
            (beat.hasSourceFermataScope || beat.voice.index === 0) &&
            !!beat.fermata &&
            beat.fermata.isInverted === this._belowStaff
        );
    }

    public createNewGlyph(_renderer: BarRendererBase, beat: Beat): EffectGlyph {
        return new FermataGlyph(0, 0, beat.fermata!.type, beat.fermata!.isInverted);
    }

    public canExpand(_from: Beat, _to: Beat): boolean {
        return true;
    }
}
