import type { SourceWedge } from '@coderline/alphatab/model/Bar';
import { CrescendoType } from '@coderline/alphatab/model/CrescendoType';
import { MusicFontSymbol } from '@coderline/alphatab/model/MusicFontSymbol';
import type { ICanvas } from '@coderline/alphatab/platform/ICanvas';
import type { BarRendererBase } from '@coderline/alphatab/rendering/BarRendererBase';
import { DynamicsGlyph } from '@coderline/alphatab/rendering/glyphs/DynamicsGlyph';
import { EffectGlyph } from '@coderline/alphatab/rendering/glyphs/EffectGlyph';

/** Timed source segments; no beat insertion, inferred playback, or onset snapping. @internal */
export class SourceWedgesGlyph extends EffectGlyph {
    private _segments: { declaration: SourceWedge; lane: number }[] = [];
    private _lineHeight = 0;
    public constructor(private readonly _declarations: SourceWedge[]) {
        super();
    }
    public static isValid(w: SourceWedge, duration: number): boolean {
        return (
            [w.displayStart, w.displayEnd, w.startProgress, w.endProgress].every(Number.isFinite) &&
            w.displayStart >= 0 &&
            w.displayEnd <= duration &&
            w.displayEnd > w.displayStart &&
            w.startProgress >= 0 &&
            w.endProgress <= 1 &&
            w.endProgress >= w.startProgress &&
            (w.type === CrescendoType.Crescendo || w.type === CrescendoType.Decrescendo)
        );
    }
    /** Use the same validated declarations for layout, painting and partial ownership. */
    public static findContinuation(
        renderer: BarRendererBase,
        current: SourceWedge,
        before: boolean
    ): SourceWedge | undefined {
        if (!current.sourceId || !SourceWedgesGlyph.isValid(current, renderer.bar.masterBar.calculateDuration())) {
            return undefined;
        }
        const currentMatches = renderer.bar.sourceWedges?.filter(
            candidate =>
                candidate.sourceId === current.sourceId &&
                SourceWedgesGlyph.isValid(candidate, renderer.bar.masterBar.calculateDuration())
        );
        if (currentMatches?.length !== 1 || currentMatches[0] !== current) {
            return undefined;
        }
        const neighbor = before ? renderer.previousRenderer : renderer.nextRenderer;
        if (!neighbor || neighbor.staff?.system !== renderer.staff?.system) {
            return undefined;
        }
        const candidates = neighbor.bar.sourceWedges?.filter(
            candidate =>
                candidate.sourceId === current.sourceId &&
                SourceWedgesGlyph.isValid(candidate, neighbor.bar.masterBar.calculateDuration())
        );
        if (candidates?.length !== 1) {
            return undefined;
        }
        const candidate = candidates[0];
        return candidate.type === current.type &&
            candidate.placement === current.placement &&
            (before
                ? current.displayStart === 0 &&
                  candidate.displayEnd === neighbor.bar.masterBar.calculateDuration() &&
                  candidate.endProgress === current.startProgress
                : current.displayEnd === renderer.bar.masterBar.calculateDuration() &&
                  candidate.displayStart === 0 &&
                  current.endProgress === candidate.startProgress)
            ? candidate
            : undefined;
    }
    private _sourceLanes(): Map<SourceWedge, number> {
        // Allocate over complete authored chains, not independently per bar.
        // A line painted through a neighboring bar must retain the same lane
        // there, including when another line ends exactly on the barline.
        type Chain = { from: number; to: number; last: SourceWedge; placement: number; marks: SourceWedge[] };
        const chains: Chain[] = [];
        const active = new Map<string, Chain>();
        for (const bar of this.renderer.bar.staff.bars) {
            const duration = bar.masterBar.calculateDuration();
            const marks = [...(bar.sourceWedges ?? [])]
                .filter(w => SourceWedgesGlyph.isValid(w, duration))
                .sort((a, b) => a.displayStart - b.displayStart);
            for (const w of marks) {
                const from = bar.masterBar.start + w.displayStart;
                const to = bar.masterBar.start + w.displayEnd;
                const placement = w.placement ?? 0;
                const previous = w.sourceId ? active.get(w.sourceId) : undefined;
                const uniqueHere = w.sourceId && marks.filter(other => other.sourceId === w.sourceId).length === 1;
                if (
                    uniqueHere &&
                    previous &&
                    previous.to === from &&
                    previous.last.endProgress === w.startProgress &&
                    previous.last.type === w.type &&
                    previous.placement === placement
                ) {
                    previous.to = to;
                    previous.last = w;
                    previous.marks.push(w);
                } else {
                    const chain = { from, to, last: w, placement, marks: [w] };
                    chains.push(chain);
                    if (uniqueHere && w.sourceId) {
                        active.set(w.sourceId, chain);
                    } else if (w.sourceId) {
                        active.delete(w.sourceId);
                    }
                }
            }
        }
        const lanes = new Map<SourceWedge, number>();
        const endsByPlacement = new Map<number, number[]>();
        for (const chain of chains.sort((a, b) => a.from - b.from)) {
            const ends = endsByPlacement.get(chain.placement) ?? [];
            let lane = ends.findIndex(end => end <= chain.from);
            if (lane < 0) {
                lane = ends.length;
            }
            ends[lane] = chain.to;
            endsByPlacement.set(chain.placement, ends);
            for (const mark of chain.marks) {
                lanes.set(mark, lane);
            }
        }
        return lanes;
    }
    public override doLayout(): void {
        this._segments = [];
        this._lineHeight = this.renderer.smuflMetrics.glyphHeights.get(MusicFontSymbol.DynamicCrescendoHairpin)!;
        const lanes = this._sourceLanes();
        let count = 0;
        for (const declaration of this._declarations) {
            if (!SourceWedgesGlyph.isValid(declaration, this.renderer.bar.masterBar.calculateDuration())) {
                continue;
            }
            const lane = lanes.get(declaration) ?? 0;
            count = Math.max(count, lane + 1);
            this._segments.push({ declaration, lane });
        }
        this.height = count ? count * (this._lineHeight + 3) - 3 : 0;
    }
    public override paint(cx: number, cy: number, canvas: ICanvas): void {
        const previousWidth = canvas.lineWidth;
        canvas.lineWidth = this.renderer.smuflMetrics.hairpinThickness;
        for (const { declaration: w, lane } of this._segments) {
            // One straight shape per visible system. Later bar segments do not
            // repaint the same authored line, and a system break keeps its opening.
            if (SourceWedgesGlyph.findContinuation(this.renderer, w, true)) {
                continue;
            }
            let lastRenderer = this.renderer,
                last = w;
            let next = SourceWedgesGlyph.findContinuation(lastRenderer, last, false);
            while (next) {
                lastRenderer = lastRenderer.nextRenderer!;
                last = next;
                next = SourceWedgesGlyph.findContinuation(lastRenderer, last, false);
            }
            let start =
                w.startProgress > 0 && !this.renderer.isFirstOfStaff
                    ? 0
                    : this.renderer.getDisplayTimeX(w.displayStart);
            let end =
                lastRenderer.x -
                this.renderer.x +
                (last.endProgress < 1 ? lastRenderer.width : lastRenderer.getDisplayTimeX(last.displayEnd));
            if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
                continue;
            }
            // Logical endpoints remain authored times; only painted ink leaves
            // room for a dynamic printed at that exact endpoint, as normal engraving.
            const dynamicClearance = (renderer: typeof this.renderer, tick: number): number => {
                let width = 0;
                for (const dynamic of renderer.bar.sourceDynamics ?? []) {
                    if (dynamic.displayStart !== tick || (dynamic.placement ?? 0) !== (w.placement ?? 0)) {
                        continue;
                    }
                    const glyph = new DynamicsGlyph(0, 0, dynamic.value);
                    glyph.renderer = renderer;
                    glyph.doLayout();
                    width = Math.max(width, glyph.width / 2 + 3);
                }
                return width;
            };
            const available = (end - start) / 4;
            if (w.startProgress === 0) {
                start += Math.min(available, dynamicClearance(this.renderer, w.displayStart));
            }
            if (last.endProgress === 1) {
                end -= Math.min(available, dynamicClearance(lastRenderer, last.displayEnd));
            }
            const opening = (progress: number) =>
                this._lineHeight * (w.type === CrescendoType.Crescendo ? progress : 1 - progress);
            const a = opening(w.startProgress) / 2,
                b = opening(last.endProgress) / 2;
            const center = cy + this.y + lane * (this._lineHeight + 3) + this._lineHeight / 2;
            // The carrier beat reserves a band only; its own x must not shift source time.
            canvas.beginPath();
            canvas.moveTo(cx + start, center - a);
            canvas.lineTo(cx + end, center - b);
            canvas.moveTo(cx + start, center + a);
            canvas.lineTo(cx + end, center + b);
            canvas.stroke();
        }
        canvas.lineWidth = previousWidth;
    }
}
