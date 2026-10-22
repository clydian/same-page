import { SourceDynamicPlacement } from '@coderline/alphatab/model/Bar';
import type { Beat } from '@coderline/alphatab/model/Beat';
import { NotationElement } from '@coderline/alphatab/NotationSettings';
import type { BarRendererBase } from '@coderline/alphatab/rendering/BarRendererBase';
import { EffectBarGlyphSizing } from '@coderline/alphatab/rendering/EffectBarGlyphSizing';
import { EffectInfo } from '@coderline/alphatab/rendering/EffectInfo';
import { DynamicsGlyph } from '@coderline/alphatab/rendering/glyphs/DynamicsGlyph';
import type { EffectGlyph } from '@coderline/alphatab/rendering/glyphs/EffectGlyph';
import { SourceDynamicsGlyph } from '@coderline/alphatab/rendering/glyphs/SourceDynamicsGlyph';
import type { Settings } from '@coderline/alphatab/Settings';

/**
 * @internal
 */
export class DynamicsEffectInfo extends EffectInfo {
    public constructor(private readonly _placement = SourceDynamicPlacement.Below) {
        super();
    }

    public override get effectId(): string {
        return this._placement === SourceDynamicPlacement.Above ? `${super.effectId}.above` : super.effectId;
    }
    public get notationElement(): NotationElement {
        return NotationElement.EffectDynamics;
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
        return this._internalShouldCreateGlyph(beat);
    }

    private _internalShouldCreateGlyph(beat: Beat): boolean {
        if (beat.voice.bar.staff.track.score.stylesheet.hideDynamics) {
            return false;
        }

        if (beat.voice.bar.sourceDynamics !== null) {
            return (
                beat.voice.index === 0 &&
                beat.index === 0 &&
                beat.voice.bar.sourceDynamics.some(
                    d => (d.placement ?? SourceDynamicPlacement.Below) === this._placement
                )
            );
        }

        if (this._placement === SourceDynamicPlacement.Above) { return false; }

        // A source declaration is a notation event even when no note sounds,
        // or when the preceding declaration has the same dynamic value.
        if (beat.isDynamicsExplicit) {
            return beat.dynamics >= 0;
        }

        if (beat.isEmpty || beat.voice.isEmpty || beat.isRest) {
            return false;
        }

        const previousBeat = this._getPreviousDynamicsBeat(beat);

        let show: boolean = (beat.voice.index === 0 && !previousBeat) || beat.dynamics !== previousBeat?.dynamics;
        // ensure we do not show duplicate dynamics
        if (show && beat.voice.index > 0) {
            for (const voice of beat.voice.bar.voices) {
                if (voice.index < beat.voice.index) {
                    const beatAtSamePos = voice.getBeatAtPlaybackStart(beat.playbackStart);
                    if (
                        beatAtSamePos &&
                        beat.dynamics === beatAtSamePos.dynamics &&
                        this._internalShouldCreateGlyph(beatAtSamePos)
                    ) {
                        show = false;
                    }
                }
            }
        }
        return show;
    }
    private _getPreviousDynamicsBeat(beat: Beat) {
        let previousBeat = beat.previousBeat;
        while (previousBeat != null) {
            if (!previousBeat.isRest || previousBeat.isDynamicsExplicit) {
                return previousBeat;
            }
            previousBeat = previousBeat.previousBeat;
        }
        return null;
    }

    public createNewGlyph(_renderer: BarRendererBase, beat: Beat): EffectGlyph {
        return beat.voice.bar.sourceDynamics !== null
            ? new SourceDynamicsGlyph(
                  beat.voice.bar.sourceDynamics.filter(
                      d => (d.placement ?? SourceDynamicPlacement.Below) === this._placement
                  )
              )
            : new DynamicsGlyph(0, 0, beat.dynamics);
    }

    public canExpand(_from: Beat, _to: Beat): boolean {
        return true;
    }
}
