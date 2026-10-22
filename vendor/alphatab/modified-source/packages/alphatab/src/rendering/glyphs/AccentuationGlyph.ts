import { AccentuationType } from '@coderline/alphatab/model/AccentuationType';
import { MusicFontSymbol } from '@coderline/alphatab/model/MusicFontSymbol';
import type { Note } from '@coderline/alphatab/model/Note';
import { TenutoPlacement } from '@coderline/alphatab/model/TenutoPlacement';
import { CanvasHelper, type ICanvas } from '@coderline/alphatab/platform/ICanvas';
import { EffectGlyph } from '@coderline/alphatab/rendering/glyphs/EffectGlyph';
import type { LineBarRenderer } from '@coderline/alphatab/rendering/LineBarRenderer';
import { BeamDirection } from '@coderline/alphatab/rendering/utils/BeamDirection';

/**
 * @internal
 */
export class AccentuationGlyph extends EffectGlyph {
    private _note: Note;
    private _accentuation: AccentuationType;
    public constructor(x: number, y: number, note: Note, accentuation: AccentuationType = note.accentuated) {
        super(x, y);
        this._note = note;
        this._accentuation = accentuation;
    }

    private static _getSymbol(accentuation: AccentuationType, above: boolean): MusicFontSymbol {
        switch (accentuation) {
            case AccentuationType.None:
                return MusicFontSymbol.None;
            case AccentuationType.Normal:
                return above ? MusicFontSymbol.ArticAccentAbove : MusicFontSymbol.ArticAccentBelow;
            case AccentuationType.Heavy:
                return above ? MusicFontSymbol.ArticMarcatoAbove : MusicFontSymbol.ArticMarcatoBelow;
            case AccentuationType.Tenuto:
                return above ? MusicFontSymbol.ArticTenutoAbove : MusicFontSymbol.ArticTenutoBelow;
            default:
                return MusicFontSymbol.None;
        }
    }

    public static isAbove(
        note: Note,
        stemDirection: BeamDirection,
        accentuation: AccentuationType = note.accentuated
    ): boolean {
        if (accentuation === AccentuationType.Tenuto) {
            switch (note.tenutoPlacement) {
                case TenutoPlacement.Above:
                    return true;
                case TenutoPlacement.Below:
                    return false;
            }
        }
        return stemDirection === BeamDirection.Down;
    }

    public override doLayout(): void {
        this.width = this.renderer.smuflMetrics.glyphWidths.get(MusicFontSymbol.ArticAccentAbove)!;
        this.height = this.renderer.smuflMetrics.glyphHeights.get(MusicFontSymbol.ArticAccentAbove)!;
    }

    public override paint(cx: number, cy: number, canvas: ICanvas): void {
        const dir = (this.renderer as LineBarRenderer).getBeatDirection(this._note.beat);
        const above = AccentuationGlyph.isAbove(this._note, dir, this._accentuation);
        const symbol = AccentuationGlyph._getSymbol(this._accentuation, above);

        const y = above ? cy + this.y + this.height : cy + this.y;
        CanvasHelper.fillMusicFontSymbolSafe(canvas, cx + this.x, y, 1, symbol, true);
    }
}
