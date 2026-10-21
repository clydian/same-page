import type { Beat } from '@coderline/alphatab/model/Beat';
import type { Font } from '@coderline/alphatab/model/Font';
import { LyricExtension, LyricPlacement, LyricSyllabic } from '@coderline/alphatab/model/LyricElement';
import { type ICanvas, TextAlign } from '@coderline/alphatab/platform/ICanvas';
import { BeatXPosition } from '@coderline/alphatab/rendering/BeatXPosition';
import { EffectGlyph } from '@coderline/alphatab/rendering/glyphs/EffectGlyph';

/**
 * @internal
 */
export class LyricsGlyph extends EffectGlyph {
    private _lines: string[];
    private _verses: number[];
    private _linePositions: number[] = [];
    private _lineWidths: number[] = [];
    private _lineHeights: number[] = [];

    public static linesForBeat(beat: Beat): string[] {
        let count = beat.lyrics?.length ?? 0;
        for (let b = beat.previousBeat; b; b = b.previousBeat) {
            count = Math.max(count, b.lyrics?.length ?? 0);
        }
        return Array.from({ length: count }, (_, i) => beat.lyrics?.[i] ?? '');
    }

    public static placementForVerse(beat: Beat, verse: number): LyricPlacement {
        for (let current: Beat | null = beat; current; current = current.previousBeat) {
            const element = current.lyricElements?.[verse];
            if (current.lyrics?.[verse] || element?.extension || element?.syllabic || element?.placement) {
                return element?.placement ?? LyricPlacement.Below;
            }
        }
        return LyricPlacement.Below;
    }

    public static versesForPlacement(beat: Beat, placement: LyricPlacement): number[] {
        return LyricsGlyph.linesForBeat(beat)
            .map((_, verse) => verse)
            .filter(verse => LyricsGlyph.placementForVerse(beat, verse) === placement);
    }

    public static extensionBefore(beat: Beat, verse: number): boolean {
        for (let b = beat.previousBeat; b; b = b.previousBeat) {
            const e = b.lyricElements?.[verse]?.extension ?? LyricExtension.None;
            if (e === LyricExtension.Stop) {
                return false;
            }
            if (e === LyricExtension.Start || e === LyricExtension.Continue) {
                return true;
            }
            if (b.lyrics?.[verse]) {
                return false;
            }
        }
        return false;
    }

    public static hasIncomingExtension(beat: Beat): boolean {
        return LyricsGlyph.linesForBeat(beat).some((_, i) => LyricsGlyph.extensionBefore(beat, i));
    }

    public static syllableBefore(beat: Beat, verse: number): boolean {
        for (let previous = beat.previousBeat; previous; previous = previous.previousBeat) {
            if (previous.lyrics?.[verse]) {
                const syllabic = previous.lyricElements?.[verse]?.syllabic;
                return syllabic === LyricSyllabic.Begin || syllabic === LyricSyllabic.Middle;
            }
        }
        return false;
    }

    public static hasIncomingSyllable(beat: Beat): boolean {
        return LyricsGlyph.linesForBeat(beat).some((_, verse) => LyricsGlyph.syllableBefore(beat, verse));
    }

    private static _nextLyricBeat(beat: Beat, verse: number): Beat | null {
        for (let next = beat.nextBeat; next; next = next.nextBeat) {
            if (next.lyrics?.[verse]) {
                return next;
            }
        }
        return null;
    }

    public font: Font;
    public textAlign: TextAlign;

    public constructor(
        x: number,
        y: number,
        lines: string[],
        font: Font,
        textAlign: TextAlign = TextAlign.Center,
        verses?: number[]
    ) {
        super(x, y);
        this._lines = lines;
        this._verses = verses ?? lines.map((_, verse) => verse);
        this.font = font;
        this.textAlign = textAlign;
    }

    public override doLayout(): void {
        super.doLayout();

        const lineSpacing = this.renderer.settings.display.lyricLinesPaddingBetween;

        const canvas = this.renderer.scoreRenderer.canvas!;
        canvas.font = this.font;
        this._linePositions = [];
        this._lineWidths = [];
        this._lineHeights = [];
        let y = 0;
        for (const line of this._lines) {
            this._linePositions.push(y);
            const size = canvas.measureText(line.length > 0 ? line : ' ');
            this._lineWidths.push(line ? size.width : 0);
            // A lyric lane is a font line, not the ink bounds of its current word.
            // Browsers correctly report zero ink height for a space; using that
            // would lift blank melisma continuation segments above the word.
            this._lineHeights.push(this.font.size);
            y += this.font.size + lineSpacing;
        }
        y -= lineSpacing;

        this.height = y;
    }

    public override paint(cx: number, cy: number, canvas: ICanvas): void {
        canvas.font = this.font;
        const old = canvas.textAlign;
        canvas.textAlign = this.textAlign;
        for (let i: number = 0; i < this._lines.length; i++) {
            if (this._lines[i]) {
                canvas.fillText(this._lines[i], cx + this.x, cy + this.y + this._linePositions[i]);
            }
        }
        canvas.textAlign = old;
        this._paintSourceConnections(cx, cy, canvas);
    }

    private _paintSourceConnections(cx: number, cy: number, canvas: ICanvas): void {
        const beat = this.beat!;
        const originX = cx - this.renderer.x;
        const next = beat.nextBeat;
        const nextRenderer = next
            ? this.renderer.scoreRenderer.layout!.getRendererForBar(this.renderer.staff!.staffId, next.voice.bar)
            : null;
        const sameSystem = nextRenderer?.staff?.system === this.renderer.staff?.system;
        const headX = cx + this.x;
        const nextX =
            nextRenderer && sameSystem
                ? originX + nextRenderer.x + nextRenderer.getBeatX(next!, BeatXPosition.MiddleNotes)
                : originX + this.renderer.x + this.renderer.width;
        const previous = beat.previousBeat;
        const newSystem = !!previous && beat.index === 0 && this.renderer.isFirstOfStaff;
        for (let line = 0; line < this._lines.length; line++) {
            const verse = this._verses[line];
            const incoming = LyricsGlyph.extensionBefore(beat, verse);
            const extension = beat.lyricElements?.[verse]?.extension ?? LyricExtension.None;
            const outgoing =
                extension === LyricExtension.Start ||
                extension === LyricExtension.Continue ||
                (extension === LyricExtension.Stop && incoming) ||
                (extension === LyricExtension.None && incoming && !this._lines[line]);
            const y = cy + this.y + this._linePositions[line] + this._lineHeights[line] - 1;
            if (incoming && newSystem && !this._lines[line]) {
                const start = cx + this.renderer.beatGlyphsStart;
                if (headX > start) {
                    canvas.fillRect(start, y, headX - start, 0.75);
                }
            }
            if (outgoing) {
                const start = headX + this._lineWidths[line] / 2 + (this._lines[line] ? 2 : 0);
                const nextText = sameSystem ? next?.lyrics?.[verse] : null;
                const end = nextText
                    ? nextX - canvas.measureText(nextText).width / 2 - 2
                    : extension === LyricExtension.Stop
                      ? originX + this.renderer.x + this.renderer.getBeatX(beat, BeatXPosition.EndBeat)
                      : nextX;
                if (end > start) {
                    canvas.fillRect(start, y, end - start, 0.75);
                }
            }
            // A syllable can cover several notes without repeating its text.
            // Its target is the next text in this verse, not necessarily nextBeat.
            const syllabic = beat.lyricElements?.[verse]?.syllabic;
            const startsSyllable = syllabic === LyricSyllabic.Begin || syllabic === LyricSyllabic.Middle;
            const continuesOnNewSystem = newSystem && !this._lines[line] && LyricsGlyph.syllableBefore(beat, verse);
            if (startsSyllable || continuesOnNewSystem) {
                const target = LyricsGlyph._nextLyricBeat(beat, verse);
                const targetRenderer = target
                    ? this.renderer.scoreRenderer.layout!.getRendererForBar(
                          this.renderer.staff!.staffId,
                          target.voice.bar
                      )
                    : null;
                if (target) {
                    const targetInSystem =
                        !!targetRenderer && targetRenderer.staff?.system === this.renderer.staff?.system;
                    const right = targetInSystem
                        ? originX +
                          targetRenderer.x +
                          targetRenderer!.getBeatX(target, BeatXPosition.MiddleNotes) -
                          canvas.measureText(target.lyrics![verse]).width / 2 -
                          2
                        : originX + this.renderer.x + this.renderer.width - 2;
                    const left = startsSyllable
                        ? headX + this._lineWidths[line] / 2 + 2
                        : cx + this.renderer.beatGlyphsStart;
                    if (right > left) {
                        canvas.fillRect((left + right) / 2 - 2, y - this._lineHeights[line] * 0.45, 4, 0.75);
                    }
                }
            }
        }
    }
}
