import type { SourceDynamic } from '@coderline/alphatab/model/Bar';
import type { ICanvas } from '@coderline/alphatab/platform/ICanvas';
import { DynamicsGlyph } from '@coderline/alphatab/rendering/glyphs/DynamicsGlyph';
import { EffectGlyph } from '@coderline/alphatab/rendering/glyphs/EffectGlyph';

/**
 * One native effect band for all staff declarations in a bar. The initial beat
 * reserves the band only; declaration timing does not belong to that beat.
 * @internal
 */
export class SourceDynamicsGlyph extends EffectGlyph {
    private _glyphs: DynamicsGlyph[] = [];

    public constructor(private readonly _declarations: SourceDynamic[]) {
        super(0, 0);
    }

    public override doLayout(): void {
        this._glyphs = [];
        this.height = 0;
        for (const declaration of this._declarations) {
            const glyph = new DynamicsGlyph(0, 0, declaration.value);
            glyph.renderer = this.renderer;
            glyph.doLayout();
            this._glyphs.push(glyph);
            this.height = Math.max(this.height, glyph.height);
        }
    }

    public override paint(cx: number, cy: number, canvas: ICanvas): void {
        for (let i = 0; i < this._declarations.length; i++) {
            const glyph = this._glyphs[i];
            glyph.x = this.renderer.getDisplayTimeX(this._declarations[i].displayStart);
            // Intentionally ignore the carrier beat's x: this is a timed bar direction.
            glyph.paint(cx, cy + this.y, canvas);
        }
    }
}
