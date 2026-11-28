import { EngravingSettings } from '@coderline/alphatab/EngravingSettings';
import { BeatSubElement, type Beat } from '@coderline/alphatab/model/Beat';
import { GraceType } from '@coderline/alphatab/model/GraceType';
import { ModelUtils } from '@coderline/alphatab/model/ModelUtils';
import { MusicFontSymbol } from '@coderline/alphatab/model/MusicFontSymbol';
import { CanvasHelper, type ICanvas } from '@coderline/alphatab/platform/ICanvas';
import { BeatXPosition } from '@coderline/alphatab/rendering/BeatXPosition';
import type { ScoreBarRenderer } from '@coderline/alphatab/rendering/ScoreBarRenderer';
import { ElementStyleHelper } from '@coderline/alphatab/rendering/utils/ElementStyleHelper';
import { BeamDirection } from '@coderline/alphatab/rendering/utils/BeamDirection';

/** Explicit logical voice beam groups; independent of staff-local Voice objects. @internal */
export class SourceBeamsGlyph {
    public constructor(private readonly _renderer: ScoreBarRenderer) {}

    public getBounds(): { top: number; bottom: number } {
        let top = Number.POSITIVE_INFINITY,
            bottom = Number.NEGATIVE_INFINITY;
        const owner = this._renderer;
        for (const { points, beamY, x1, x2, levels, direction, scale } of this._groups()) {
            const offset = levels * (owner.smuflMetrics.beamThickness + owner.smuflMetrics.beamSpacing) * scale;
            const ys = [
                ...points.map(p => p.y),
                beamY(x1),
                beamY(x2),
                beamY(x1) + (direction === BeamDirection.Down ? -offset : offset),
                beamY(x2) + (direction === BeamDirection.Down ? -offset : offset)
            ];
            top = Math.min(top, ...ys);
            bottom = Math.max(bottom, ...ys);
        }
        return { top: owner.staff!.y + owner.y + top, bottom: owner.staff!.y + owner.y + bottom };
    }

    private _sourceGroups(): Beat[][] {
        const owner = this._renderer;
        const ids = new Set(owner.bar.voices.flatMap(v => v.beats.map(b => b.sourceBeamGroup)).filter(id => id > 0));
        const groups: Beat[][] = [];
        for (const id of ids) {
            const members = owner.bar.staff.track.staves
                .flatMap(s =>
                    s.bars.flatMap(b => b.voices.flatMap(v => v.beats.filter(beat => beat.sourceBeamGroup === id)))
                )
                .sort((a, b) =>
                    a.absoluteDisplayStart - b.absoluteDisplayStart || a.sourceBeamGroupIndex - b.sourceBeamGroupIndex
                );
            let group: Beat[] = [];
            for (const beat of members) {
                if (beat.sourceBeamGroupIndex === 0) {
                    group = [];
                    groups.push(group);
                }
                group.push(beat);
            }
        }
        return groups.filter(
            group =>
                group.length === group[0].sourceBeamGroupSize &&
                group.every((b, i) => b.sourceBeamGroupIndex === i && b.sourceBeamGroupSize === group.length)
        );
    }

    private *_groups() {
        const owner = this._renderer;
        for (const members of this._sourceGroups()) {
            const segment: { beat: Beat; renderer: ScoreBarRenderer }[] = [];
            for (const beat of members) {
                const renderer = owner.scoreRenderer.layout!.getRendererForBar(
                    owner.staff!.staffId,
                    beat.voice.bar
                ) as ScoreBarRenderer | null;
                if (renderer && renderer.staff && renderer.staff.system === owner.staff?.system) {
                    segment.push({ beat, renderer });
                }
            }
            // Each system segment is owned by its first source beat, never by
            // whichever staff happens to paint first. No inter-system diagonal.
            if (segment.length === 0 || segment[0].renderer !== owner) {
                continue;
            }
            const direction = segment[0].beat.preferredBeamDirection!;
            const points = segment.map(({ beat, renderer }) => ({
                beat,
                x: renderer.x - owner.x + renderer.getBeatX(beat, BeatXPosition.Stem),
                y: renderer.staff!.y - owner.staff!.y + renderer.y - owner.y + renderer.sourceBeamStemStartY(beat),
                end: renderer.staff!.y - owner.staff!.y + renderer.y - owner.y + renderer.sourceBeamStemEndY(beat)
            }));
            const first = points[0],
                last = points[points.length - 1];
            if (points.some(p => ![p.x, p.y, p.end].every(Number.isFinite)) || last.x < first.x) {
                continue;
            }
            const clearance = owner.lineSpacing * 2;
            const firstOpposing = points.findIndex(point => point.beat.preferredBeamDirection !== direction);
            let beamY: (x: number) => number;
            if (firstOpposing > 0) {
                const upLimit = Math.min(
                    ...points.filter(p => p.beat.preferredBeamDirection === BeamDirection.Up).map(p => p.y)
                ) - owner.lineSpacing / 2;
                const downLimit = Math.max(
                    ...points.filter(p => p.beat.preferredBeamDirection === BeamDirection.Down).map(p => p.y)
                ) + owner.lineSpacing / 2;
                const between = (upLimit + downLimit) / 2;
                if (downLimit <= upLimit) {
                    beamY = () => between;
                } else {
                    // For intruding ledger notes, slope across the switch where the
                    // authored up-stem and down-stem runs stop constraining each other.
                    const left = points[firstOpposing - 1].x;
                    const right = points[firstOpposing].x;
                    const slope = (downLimit - upLimit) / Math.max(1, right - left) *
                        (direction === BeamDirection.Up ? 1 : -1);
                    beamY = x => between + (x - (left + right) / 2) * slope;
                }
            } else {
                const slope = last.x === first.x ? 0 : (last.end - first.end) / (last.x - first.x);
                const line = (x: number) => first.end + slope * (x - first.x);
                const adjustment =
                    direction === BeamDirection.Down
                        ? Math.max(0, ...points.map(p => p.y + clearance - line(p.x)))
                        : Math.min(0, ...points.map(p => p.y - clearance - line(p.x)));
                beamY = x => line(x) + adjustment;
            }
            const levels = ModelUtils.getIndex(first.beat.duration) - 2;
            const scale = first.beat.graceType === GraceType.None ? 1 : EngravingSettings.GraceScale;
            // A one-note system fragment keeps short continuation beams, not a
            // newly invented flag or a line reaching another system's coordinates.
            const x1 = first.x,
                x2 =
                    points.length > 1
                        ? last.x + owner.smuflMetrics.stemThickness
                        : first.x + owner.smuflMetrics.brokenBeamWidth;
            yield { points, direction, beamY, x1, x2, levels, scale };
        }
    }

    public paint(cx: number, cy: number, canvas: ICanvas): void {
        const owner = this._renderer;
        for (const { points, direction, beamY, x1, x2, levels, scale } of this._groups()) {
            const first = points[0];
            const thickness = owner.smuflMetrics.beamThickness * scale;
            const spacing = owner.smuflMetrics.beamSpacing * scale;
            const oldColor = canvas.color;
            canvas.color =
                first.beat.voice.index === 0 ? owner.resources.mainGlyphColor : owner.resources.secondaryGlyphColor;
            for (const point of points) {
                const y = beamY(point.x);
                using _ = ElementStyleHelper.beat(canvas, BeatSubElement.StandardNotationStem, point.beat);
                canvas.fillRect(
                    cx + point.x,
                    cy + Math.min(point.y, y),
                    owner.smuflMetrics.stemThickness,
                    Math.abs(point.y - y)
                );
            }
            using _ = ElementStyleHelper.beat(canvas, BeatSubElement.StandardNotationBeams, first.beat);
            for (let level = 0; level < levels; level++) {
                const offset =
                    level *
                    (thickness + spacing) *
                    (direction === BeamDirection.Down ? -1 : 1);
                const y1 = cy + beamY(x1) + offset,
                    y2 = cy + beamY(x2) + offset;
                const size =
                    direction === BeamDirection.Down ? -thickness : thickness;
                canvas.beginPath();
                canvas.moveTo(cx + x1, y1);
                canvas.lineTo(cx + x2, y2);
                canvas.lineTo(cx + x2, y2 + size);
                canvas.lineTo(cx + x1, y1 + size);
                canvas.closePath();
                canvas.fill();
            }
            if (
                first.beat.graceType === GraceType.BeforeBeat &&
                first.beat.sourceGraceMakeTime === undefined &&
                first.beat.sourceBeamGroupIndex === 0
            ) {
                const slash = direction === BeamDirection.Down
                    ? MusicFontSymbol.GraceNoteSlashStemDown
                    : MusicFontSymbol.GraceNoteSlashStemUp;
                const metrics = owner.smuflMetrics;
                const glyphCenter = (metrics.glyphTop.get(slash)! + metrics.glyphBottom.get(slash)!) * scale / 2;
                const stemCenter = (first.y + beamY(first.x)) / 2;
                CanvasHelper.fillMusicFontSymbolSafe(
                    canvas,
                    cx + first.x + metrics.stemThickness / 2,
                    cy + stemCenter + glyphCenter,
                    scale,
                    slash,
                    true
                );
            }
            canvas.color = oldColor;
        }
    }
}
