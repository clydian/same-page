import { SourceArpeggio, SourceArpeggioDirection } from '@coderline/alphatab/model/SourceArpeggio';
import type { Note } from '@coderline/alphatab/model/Note';
import { VibratoType } from '@coderline/alphatab/model/VibratoType';
import { MusicFontSymbol } from '@coderline/alphatab/model/MusicFontSymbol';
import type { ICanvas } from '@coderline/alphatab/platform/ICanvas';
import { NoteYPosition } from '@coderline/alphatab/rendering/BarRendererBase';
import type { ScoreBarRenderer } from '@coderline/alphatab/rendering/ScoreBarRenderer';
import { Glyph } from '@coderline/alphatab/rendering/glyphs/Glyph';
import { NoteVibratoGlyph } from '@coderline/alphatab/rendering/glyphs/NoteVibratoGlyph';

/** A single authored wave spanning the visible members of a part/onset/number group.
 * @internal
 */
export class SourceArpeggioGlyph extends Glyph {
    private _note: Note;
    private _wave: NoteVibratoGlyph;

    public constructor(note: Note) {
        super(0, 0);
        this._note = note;
        this._wave = new NoteVibratoGlyph(0, 0, VibratoType.Slight, true);
    }

    public override doLayout(): void {
        this._wave.renderer = this.renderer;
        this._wave.doLayout();
        this.width = this._wave.height;
    }

    public override paint(cx: number, cy: number, canvas: ICanvas): void {
        const own = this.renderer as ScoreBarRenderer;
        const group = SourceArpeggio.members(this._note);
        // An explicit break changes engraving only, never the common playback group.
        // If authored hints conflict, a break wins rather than drawing an unwanted line.
        const broken = group.some(note => note.sourceArpeggio!.unbroken === false);
        const members = group
            .filter(
                note => note.isVisible && (!broken || note.beat.voice.bar.staff === this._note.beat.voice.bar.staff)
            )
            .map(note => ({
                note,
                renderer: own.scoreRenderer.layout!.getRendererForBar(
                    own.staff!.staffId,
                    note.beat.voice.bar
                ) as ScoreBarRenderer | null
            }))
            .filter(m => m.renderer !== null);
        // Every participating beat reserves the same pre-note space. Only the first
        // visible beat paints, including when a caller renders a subset of staves.
        if (members.length === 0 || members[0].note.beat !== this._note.beat) {
            return;
        }
        const origin = own.y + own.staff!.y;
        const ys = members.map(
            m => m.renderer!.getNoteY(m.note, NoteYPosition.Center) + m.renderer!.y + m.renderer!.staff!.y - origin
        );
        const top = cy + this.y + Math.min(...ys) - own.lineOffset;
        const bottom = cy + this.y + Math.max(...ys) + own.lineOffset;
        const direction =
            group.find(note => note.sourceArpeggio!.direction !== SourceArpeggioDirection.None)?.sourceArpeggio
                ?.direction ?? SourceArpeggioDirection.None;
        const arrowSize =
            direction === SourceArpeggioDirection.None
                ? 0
                : own.smuflMetrics.glyphWidths.get(MusicFontSymbol.ArrowheadBlackDown)!;
        const start = top + (direction === SourceArpeggioDirection.Up ? arrowSize : 0);
        const end = bottom - (direction === SourceArpeggioDirection.Down ? arrowSize : 0);
        this._wave.width = Math.max(0, end - start);
        canvas.beginRotate(cx + this.x, start, 90);
        this._wave.paint(0, -this._wave.height, canvas);
        canvas.endRotate();
        if (direction !== SourceArpeggioDirection.None) {
            const x = cx + this.x + this.width / 2;
            const tip = direction === SourceArpeggioDirection.Up ? top : bottom;
            const base = tip + (direction === SourceArpeggioDirection.Up ? arrowSize : -arrowSize);
            canvas.beginPath();
            canvas.moveTo(x, tip);
            canvas.lineTo(x + arrowSize / 2, base);
            canvas.lineTo(x - arrowSize / 2, base);
            canvas.closePath();
            canvas.fill();
        }
    }
}
