import type { SourceText } from '@coderline/alphatab/model/Bar';
import { Font, FontStyle, FontWeight } from '@coderline/alphatab/model/Font';
import { NotationElement } from '@coderline/alphatab/NotationSettings';
import type { ICanvas } from '@coderline/alphatab/platform/ICanvas';
import { TextAlign } from '@coderline/alphatab/platform/ICanvas';
import { EffectGlyph } from '@coderline/alphatab/rendering/glyphs/EffectGlyph';
import { TextGlyph } from '@coderline/alphatab/rendering/glyphs/TextGlyph';

const genericFontFamilies = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui']);

/** Each independent source instruction reserves its own line, never overwrites. @internal */
export class SourceTextsGlyph extends EffectGlyph {
    private _glyphs: TextGlyph[] = [];
    public constructor(private readonly _declarations: SourceText[]) {
        super();
    }
    public static isValid(t: SourceText, duration: number): boolean {
        return (
            Number.isFinite(t.displayStart) &&
            t.displayStart >= 0 &&
            t.displayStart <= duration &&
            typeof t.text === 'string' &&
            t.text.length > 0 &&
            (t.fontSize === undefined || (Number.isFinite(t.fontSize) && t.fontSize > 0)) &&
            (t.fontFamilies === undefined ||
                (Array.isArray(t.fontFamilies) && t.fontFamilies.length > 0 &&
                    t.fontFamilies.every(family => genericFontFamilies.has(family))))
        );
    }
    public override doLayout(): void {
        this._glyphs = [];
        this.height = 0;
        for (const t of this._declarations) {
            const base = this.renderer.resources.elementFonts.get(NotationElement.EffectText)!;
            const font = Font.withFamilyList(
                t.fontFamilies ?? [base.family],
                t.fontSize ?? base.size,
                t.italic === undefined ? base.style : t.italic ? FontStyle.Italic : FontStyle.Plain,
                t.bold === undefined ? base.weight : t.bold ? FontWeight.Bold : FontWeight.Regular
            );
            const g = new TextGlyph(0, this.height, t.text, font, TextAlign.Left);
            g.renderer = this.renderer;
            g.doLayout();
            this._glyphs.push(g);
            this.height += g.height + 3;
        }
        if (this._glyphs.length) {
            this.height -= 3;
        }
    }
    public override paint(cx: number, cy: number, canvas: ICanvas): void {
        for (let i = 0; i < this._declarations.length; i++) {
            const g = this._glyphs[i];
            g.x = this.renderer.getDisplayTimeX(this._declarations[i].displayStart);
            g.paint(cx, cy + this.y, canvas);
        }
    }
}
