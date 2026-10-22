import type { SourceBracket } from '@coderline/alphatab/model/Bar';
import type { ICanvas } from '@coderline/alphatab/platform/ICanvas';
import type { ScoreBarRenderer } from '@coderline/alphatab/rendering/ScoreBarRenderer';

/** Authored direction graphics, deliberately independent of playback ornaments. @internal */
export class SourceBracketsGlyph {
    public constructor(private readonly _renderer: ScoreBarRenderer) {}

    public static isValid(mark: SourceBracket, duration: number): boolean {
        return (
            [
                mark.displayStart,
                mark.displayEnd,
                mark.startY,
                mark.endY,
                mark.startRelativeX,
                mark.endRelativeX,
                mark.startEndLength,
                mark.endEndLength
            ].every(Number.isFinite) &&
            (mark.startX === undefined || Number.isFinite(mark.startX)) &&
            (mark.endX === undefined || Number.isFinite(mark.endX)) &&
            mark.displayStart >= 0 &&
            mark.displayEnd > mark.displayStart &&
            mark.displayEnd <= duration &&
            mark.startEndLength >= 0 &&
            mark.endEndLength >= 0 &&
            ['solid', 'wavy'].includes(mark.lineType) &&
            [mark.startLineEnd, mark.endLineEnd].every(end => ['none', 'up', 'down', 'both'].includes(end))
        );
    }

    private _marks(renderer = this._renderer): SourceBracket[] {
        return (renderer.bar.sourceBrackets ?? []).filter(mark =>
            SourceBracketsGlyph.isValid(mark, renderer.bar.masterBar.calculateDuration(false))
        );
    }

    private _continuation(renderer: ScoreBarRenderer, mark: SourceBracket, before: boolean): SourceBracket | undefined {
        if (!mark.sourceId || this._marks(renderer).filter(m => m.sourceId === mark.sourceId).length !== 1) {
            return undefined;
        }
        const neighbor = before ? renderer.previousRenderer : renderer.nextRenderer;
        if (!neighbor || neighbor.staff?.system !== renderer.staff?.system || neighbor.staff !== renderer.staff) {
            return undefined;
        }
        const matches = this._marks(neighbor as ScoreBarRenderer).filter(m => m.sourceId === mark.sourceId);
        if (matches.length !== 1) {
            return undefined;
        }
        const other = matches[0];
        return other.lineType === mark.lineType &&
            (before
                ? !mark.isStart &&
                  !other.isEnd &&
                  mark.displayStart === 0 &&
                  other.displayEnd === neighbor.bar.masterBar.calculateDuration(false) &&
                  other.endY === mark.startY
                : !mark.isEnd &&
                  !other.isStart &&
                  other.displayStart === 0 &&
                  mark.displayEnd === renderer.bar.masterBar.calculateDuration(false) &&
                  mark.endY === other.startY)
            ? other
            : undefined;
    }

    public hasPreviousContinuation(): boolean {
        return this._marks().some(mark => this._continuation(this._renderer, mark, true) !== undefined);
    }

    public registerOverflows(rendererBottom: number): void {
        const renderer = this._renderer;
        const unit = renderer.lineSpacing / 10;
        for (const mark of this._marks()) {
            const ys = [renderer.getScoreY(0) - mark.startY * unit, renderer.getScoreY(0) - mark.endY * unit];
            const addEnds = (y: number, kind: string, length: number) => {
                if (kind === 'up' || kind === 'both') {
                    ys.push(y - length * unit);
                }
                if (kind === 'down' || kind === 'both') {
                    ys.push(y + length * unit);
                }
            };
            if (mark.isStart) {
                addEnds(ys[0], mark.startLineEnd, mark.startEndLength);
            }
            if (mark.isEnd) {
                addEnds(ys[1], mark.endLineEnd, mark.endEndLength);
            }
            const wave = mark.lineType === 'wavy' ? renderer.lineSpacing / 3 : 0;
            renderer.registerOverflowTop(Math.max(0, -Math.min(...ys) + wave));
            renderer.registerOverflowBottom(Math.max(0, Math.max(...ys) + wave - rendererBottom));
        }
    }

    public paint(cx: number, cy: number, canvas: ICanvas): void {
        const renderer = this._renderer;
        const unit = renderer.lineSpacing / 10;
        const oldWidth = canvas.lineWidth;
        canvas.lineWidth = renderer.smuflMetrics.hairpinThickness;
        for (const mark of this._marks()) {
            if (this._continuation(renderer, mark, true)) {
                continue;
            }
            let lastRenderer = renderer;
            let last = mark;
            let next = this._continuation(lastRenderer, last, false);
            while (next) {
                lastRenderer = lastRenderer.nextRenderer as ScoreBarRenderer;
                last = next;
                next = this._continuation(lastRenderer, last, false);
            }
            let x1 =
                mark.isStart && mark.startX !== undefined
                    ? mark.startX * unit
                    : !mark.isStart && !renderer.isFirstOfStaff
                      ? 0
                      : renderer.getDisplayTimeX(mark.displayStart);
            let x2 =
                lastRenderer.x -
                renderer.x +
                (last.isEnd && last.endX !== undefined
                    ? last.endX * unit
                    : last.isEnd
                      ? lastRenderer.getDisplayTimeX(last.displayEnd)
                      : lastRenderer.width);
            if (mark.isStart) {
                x1 += mark.startRelativeX * unit;
            }
            if (last.isEnd) {
                x2 += last.endRelativeX * unit;
            }
            if (!Number.isFinite(x1) || !Number.isFinite(x2) || x2 <= x1) {
                continue;
            }
            const y1 = renderer.getScoreY(0) - mark.startY * unit;
            const y2 = lastRenderer.getScoreY(0) - last.endY * unit;
            canvas.beginPath();
            canvas.moveTo(cx + x1, cy + y1);
            if (mark.lineType === 'wavy') {
                const count = Math.max(2, Math.ceil((x2 - x1) / (renderer.lineSpacing / 2)));
                for (let i = 1; i < count; i++) {
                    const fraction = i / count;
                    canvas.lineTo(
                        cx + x1 + (x2 - x1) * fraction,
                        cy + y1 + (y2 - y1) * fraction + ((i % 2 ? 1 : -1) * renderer.lineSpacing) / 3
                    );
                }
            }
            canvas.lineTo(cx + x2, cy + y2);
            const end = (x: number, y: number, kind: string, length: number) => {
                if (kind === 'up' || kind === 'both') {
                    canvas.moveTo(cx + x, cy + y);
                    canvas.lineTo(cx + x, cy + y - length * unit);
                }
                if (kind === 'down' || kind === 'both') {
                    canvas.moveTo(cx + x, cy + y);
                    canvas.lineTo(cx + x, cy + y + length * unit);
                }
            };
            if (mark.isStart) {
                end(x1, y1, mark.startLineEnd, mark.startEndLength);
            }
            if (last.isEnd) {
                end(x2, y2, last.endLineEnd, last.endEndLength);
            }
            canvas.stroke();
        }
        canvas.lineWidth = oldWidth;
    }
}
