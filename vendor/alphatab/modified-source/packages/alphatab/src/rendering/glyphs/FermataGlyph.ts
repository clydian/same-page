import { FermataType } from '@coderline/alphatab/model/Fermata';
import { MusicFontSymbol } from '@coderline/alphatab/model/MusicFontSymbol';
import type { ICanvas } from '@coderline/alphatab/platform/ICanvas';
import { MusicFontGlyph } from '@coderline/alphatab/rendering/glyphs/MusicFontGlyph';

/**
 * @internal
 */
export class FermataGlyph extends MusicFontGlyph {
    public constructor(
        x: number,
        y: number,
        fermata: FermataType,
        private readonly _isInverted: boolean = false
    ) {
        super(x, y, 1, FermataGlyph._getSymbol(fermata, _isInverted));
    }

    private static _getSymbol(accentuation: FermataType, inverted: boolean): MusicFontSymbol {
        switch (accentuation) {
            case FermataType.Short:
                return inverted ? MusicFontSymbol.FermataShortBelow : MusicFontSymbol.FermataShortAbove;
            case FermataType.Medium:
                return inverted ? MusicFontSymbol.FermataBelow : MusicFontSymbol.FermataAbove;
            case FermataType.Long:
                return inverted ? MusicFontSymbol.FermataLongBelow : MusicFontSymbol.FermataLongAbove;
            default:
                return MusicFontSymbol.None;
        }
    }

    public override paint(cx: number, cy: number, canvas: ICanvas): void {
        super.paint(
            cx - this.width / 2,
            cy + (this._isInverted ? this.renderer.smuflMetrics.glyphTop.get(this.symbol)! : this.height),
            canvas
        );
    }
}
