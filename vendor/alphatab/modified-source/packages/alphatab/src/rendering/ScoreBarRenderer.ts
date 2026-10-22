import { LayoutMode } from '@coderline/alphatab/LayoutMode';
import { AccidentalType } from '@coderline/alphatab/model/AccidentalType';
import { type Bar, BarSubElement, type StaffNotationChange } from '@coderline/alphatab/model/Bar';
import { type Beat, BeatSubElement } from '@coderline/alphatab/model/Beat';
import { Clef } from '@coderline/alphatab/model/Clef';
import { GraceType } from '@coderline/alphatab/model/GraceType';
import { KeySignature } from '@coderline/alphatab/model/KeySignature';
import { ModelUtils } from '@coderline/alphatab/model/ModelUtils';
import type { Note } from '@coderline/alphatab/model/Note';
import { Ottavia } from '@coderline/alphatab/model/Ottavia';
import { Staff } from '@coderline/alphatab/model/Staff';
import { TremoloPickingType } from '@coderline/alphatab/model/TremoloPickingEffect';
import type { Voice } from '@coderline/alphatab/model/Voice';
import type { ICanvas } from '@coderline/alphatab/platform/ICanvas';
import { NoteYPosition } from '@coderline/alphatab/rendering/BarRendererBase';
import { BeatXPosition } from '@coderline/alphatab/rendering/BeatXPosition';
import { AccidentalGlyph } from '@coderline/alphatab/rendering/glyphs/AccidentalGlyph';
import { ClefGlyph } from '@coderline/alphatab/rendering/glyphs/ClefGlyph';
import type { Glyph } from '@coderline/alphatab/rendering/glyphs/Glyph';
import { KeySignatureGlyph } from '@coderline/alphatab/rendering/glyphs/KeySignatureGlyph';
import { LeftToRightLayoutingGlyphGroup } from '@coderline/alphatab/rendering/glyphs/LeftToRightLayoutingGlyphGroup';
import { ScoreTimeSignatureGlyph } from '@coderline/alphatab/rendering/glyphs/ScoreTimeSignatureGlyph';
import { SourceBeamsGlyph } from '@coderline/alphatab/rendering/glyphs/SourceBeamsGlyph';
import { SourceBracketsGlyph } from '@coderline/alphatab/rendering/glyphs/SourceBracketsGlyph';
import { SpacingGlyph } from '@coderline/alphatab/rendering/glyphs/SpacingGlyph';
import { LineBarRenderer } from '@coderline/alphatab/rendering/LineBarRenderer';
import { ScoreBeatContainerGlyph } from '@coderline/alphatab/rendering/ScoreBeatContainerGlyph';
import type { ScoreRenderer } from '@coderline/alphatab/rendering/ScoreRenderer';
import { AccidentalHelper } from '@coderline/alphatab/rendering/utils/AccidentalHelper';
import { BeamDirection } from '@coderline/alphatab/rendering/utils/BeamDirection';
import type { BeamingHelper } from '@coderline/alphatab/rendering/utils/BeamingHelper';
import { ElementStyleHelper } from '@coderline/alphatab/rendering/utils/ElementStyleHelper';

/**
 * This BarRenderer renders a bar using standard music notation.
 * @internal
 */
export class ScoreBarRenderer extends LineBarRenderer {
    public static readonly StaffId: string = 'score';
    private static _sharpKsSteps: number[] = [-1, 2, -2, 1, 4, 0, 3];
    private static _flatKsSteps: number[] = [3, 0, 4, 1, 5, 2, 6];

    public accidentalHelper: AccidentalHelper;
    private _sourceBrackets = new SourceBracketsGlyph(this);
    private _sourceBeams = new SourceBeamsGlyph(this);
    private _hasEndNotationChanges: boolean = false;
    private _notationGlyphs: { displayStart: number; glyph: LeftToRightLayoutingGlyphGroup }[] = [];

    public constructor(renderer: ScoreRenderer, bar: Bar) {
        super(renderer, bar);
        this.accidentalHelper = new AccidentalHelper(this);
    }

    public override doLayout(): void {
        super.doLayout();
        if (
            this.settings.display.layoutMode === LayoutMode.Horizontal &&
            this._sourceBrackets.hasPreviousContinuation()
        ) {
            this.isLinkedToPrevious = true;
        }
    }

    public override finalizeRenderer(): boolean {
        if (this.bar.voices.some(v => v.beats.some(b => b.sourceBeamGroup !== 0))) {
            this.staff!.system.registerSourceBeams(this._sourceBeams);
        }
        return super.finalizeRenderer();
    }

    protected override paintContent(cx: number, cy: number, canvas: ICanvas): void {
        super.paintContent(cx, cy, canvas);
        this._sourceBrackets.paint(cx + this.x, cy + this.y, canvas);
        this._sourceBeams.paint(cx + this.x, cy + this.y, canvas);
        this._paintDoubleTremolos(cx + this.x, cy + this.y, canvas);
        for (const { displayStart, glyph } of this._notationGlyphs) {
            const spring = this.layoutingInfo.springs.get(this.bar.masterBar.start + displayStart);
            glyph.x = this.getDisplayTimeX(displayStart) - (spring?.preSpringWidth ?? glyph.width);
            glyph.paint(cx + this.x, cy + this.y, canvas);
        }
    }

    private _paintDoubleTremolos(cx: number, cy: number, canvas: ICanvas): void {
        for (const voice of this.bar.voices) {
            for (const beat of voice.beats) {
                const partner = beat.doubleTremoloPartner;
                if (beat.tremoloPicking?.type !== TremoloPickingType.Start || !partner) {
                    continue;
                }
                const startDirection = this.getBeatDirection(beat),
                    endDirection = this.getBeatDirection(partner);
                const startX = this.getBeatX(beat, BeatXPosition.Stem),
                    endX = this.getBeatX(partner, BeatXPosition.Stem) + this.smuflMetrics.stemThickness;
                const startHelper = this.helpers.getBeamingHelperForBeat(beat),
                    endHelper = this.helpers.getBeamingHelperForBeat(partner);
                const startY =
                    startHelper && !this.drawBeamHelperAsFlags(startHelper)
                        ? this.calculateBeamY(startHelper, startX)
                        : startDirection === BeamDirection.Up
                          ? this.getFlagTopY(beat, startDirection)
                          : this.getFlagBottomY(beat, startDirection);
                const endY =
                    endHelper && !this.drawBeamHelperAsFlags(endHelper)
                        ? this.calculateBeamY(endHelper, endX - this.smuflMetrics.stemThickness)
                        : endDirection === BeamDirection.Up
                          ? this.getFlagTopY(partner, endDirection)
                          : this.getFlagBottomY(partner, endDirection);
                const attachedBeams = Math.max(0, ModelUtils.getIndex(beat.duration) - 2);
                const marks = beat.tremoloPicking.marks,
                    thickness = this.beamThickness,
                    spacing = thickness + this.beamSpacing;
                if (![startX, endX, startY, endY].every(Number.isFinite) || endX <= startX) {
                    continue;
                }
                const oldColor = canvas.color;
                canvas.color = voice.index === 0 ? this.resources.mainGlyphColor : this.resources.secondaryGlyphColor;
                using _ = ElementStyleHelper.beat(canvas, this.beamsSubElement, beat);
                for (let mark = 0; mark < marks; mark++) {
                    const offset1 =
                        startDirection === BeamDirection.Up
                            ? (mark + attachedBeams) * spacing
                            : -(mark + attachedBeams) * spacing - thickness;
                    const offset2 =
                        endDirection === BeamDirection.Up
                            ? (mark + attachedBeams) * spacing
                            : -(mark + attachedBeams) * spacing - thickness;
                    canvas.beginPath();
                    canvas.moveTo(cx + startX, cy + startY + offset1);
                    canvas.lineTo(cx + endX, cy + endY + offset2);
                    canvas.lineTo(cx + endX, cy + endY + offset2 + thickness);
                    canvas.lineTo(cx + startX, cy + startY + offset1 + thickness);
                    canvas.closePath();
                    canvas.fill();
                }
                canvas.color = oldColor;
            }
        }
    }

    public override get repeatsBarSubElement(): BarSubElement {
        return BarSubElement.StandardNotationRepeats;
    }

    public override get barNumberBarSubElement(): BarSubElement {
        return BarSubElement.StandardNotationBarNumber;
    }

    public override get barLineBarSubElement(): BarSubElement {
        return BarSubElement.StandardNotationBarLines;
    }

    public override get staffLineBarSubElement(): BarSubElement {
        return BarSubElement.StandardNotationStaffLine;
    }

    public override get lineSpacing(): number {
        return this.smuflMetrics.oneStaffSpace;
    }

    public override get heightLineCount(): number {
        return Math.max(5, this.bar.staff.standardNotationLineCount);
    }

    public override get drawnLineCount(): number {
        return this.bar.staff.standardNotationLineCount;
    }

    /**
     * Gets the relative y position of the given steps relative to first line.
     * @param steps the amount of steps while 2 steps are one line
     * @returns
     */
    public getScoreY(steps: number): number {
        return super.getLineY(steps / 2);
    }

    /**
     * Gets the height of an element that spans the given amount of steps.
     * @param steps the amount of steps while 2 steps are one line
     * @param correction
     * @returns
     */
    public getScoreHeight(steps: number): number {
        return super.getLineHeight(steps / 2);
    }

    protected override calculateOverflows(rendererTop: number, rendererBottom: number): void {
        super.calculateOverflows(rendererTop, rendererBottom);
        this._sourceBrackets.registerOverflows(rendererBottom);
        if (this.bar.isEmpty) {
            return;
        }
        this.calculateBeamingOverflows(rendererTop, rendererBottom);
    }

    protected override get flagsSubElement(): BeatSubElement {
        return BeatSubElement.StandardNotationFlags;
    }

    protected override get beamsSubElement(): BeatSubElement {
        return BeatSubElement.StandardNotationBeams;
    }

    protected override get tupletSubElement(): BeatSubElement {
        return BeatSubElement.StandardNotationTuplet;
    }

    protected override getFlagTopY(beat: Beat, direction: BeamDirection): number {
        const position = direction === BeamDirection.Up ? NoteYPosition.TopWithStem : NoteYPosition.StemDown;
        if (beat.isRest) {
            return this.getRestY(beat, position);
        } else {
            return this.voiceContainer.getHighestNoteY(beat, position);
        }
    }

    protected override getFlagBottomY(beat: Beat, direction: BeamDirection): number {
        const position = direction === BeamDirection.Up ? NoteYPosition.StemUp : NoteYPosition.BottomWithStem;

        if (beat.isRest) {
            return this.getRestY(beat, position);
        } else {
            return this.voiceContainer.getLowestNoteY(beat, position);
        }
    }

    public sourceBeamStemStartY(beat: Beat): number {
        return beat.preferredBeamDirection === BeamDirection.Up
            ? this.getFlagBottomY(beat, BeamDirection.Up)
            : this.getFlagTopY(beat, BeamDirection.Down);
    }

    public sourceBeamStemEndY(beat: Beat): number {
        return beat.preferredBeamDirection === BeamDirection.Up
            ? this.getFlagTopY(beat, BeamDirection.Up)
            : this.getFlagBottomY(beat, BeamDirection.Down);
    }

    protected override getBeamDirection(helper: BeamingHelper): BeamDirection {
        return this._beamDirections.has(helper) ? this._beamDirections.get(helper)! : BeamDirection.Up;
    }

    public centerStaffStemY(direction: BeamDirection) {
        const isStandardFive = this.bar.staff.standardNotationLineCount === Staff.DefaultStandardNotationLineCount;
        if (isStandardFive) {
            // center on the middle line for a standard 5-line staff
            return this.getScoreY(this.bar.staff.standardNotationLineCount - 1);
        }

        // for other staff line counts, we align the stem either on the top or bottom line
        if (direction === BeamDirection.Up) {
            return this.getScoreY(this.bar.staff.standardNotationLineCount * 2);
        }
        return this.getScoreY(0);
    }

    public override get middleYPosition(): number {
        return this.getScoreY(this.bar.staff.standardNotationLineCount - 1);
    }

    public override applyLayoutingInfo(): boolean {
        const result = super.applyLayoutingInfo();
        if (result && this.bar.isMultiVoice) {
            // consider rest overflows
            const top: number = this.getScoreY(-2);
            const bottom: number = this.getScoreY(this.heightLineCount * 2);
            const minMax = this.helpers.collisionHelper.getBeatMinMaxY();
            if (minMax[0] < top) {
                this.registerOverflowTop(Math.abs(minMax[0]));
            }
            if (minMax[1] > bottom) {
                this.registerOverflowBottom(Math.abs(minMax[1]) - bottom);
            }
        }
        return result;
    }

    protected override getMinLineOfBeat(beat: Beat): number {
        return this.accidentalHelper.getMinSteps(beat) / 2;
    }

    protected override getMaxLineOfBeat(beat: Beat): number {
        return this.accidentalHelper.getMaxSteps(beat) / 2;
    }

    protected override createLinePreBeatGlyphs(): void {
        // Clef
        let hasClef = false;
        if (
            this.isFirstOfStaff ||
            this.bar.clef !== this.bar.previousBar!.getClefAt(Number.POSITIVE_INFINITY) ||
            this.bar.clefOttava !== this.bar.previousBar!.getClefOttavaAt(Number.POSITIVE_INFINITY)
        ) {
            // SMUFL: Clefs should be positioned such that the pitch the clef refers to is on the baseline
            // (e.g. the F clef is placed such that the upper dot is above and the lower dot below the baseline).
            // If a clef does not refer specifically to a pitch, its y=0 should coincide with the center staff line on a five-line staff, or the visual center for staves with more or fewer than five lines (e.g. tablature staves).

            let offset = 0;
            switch (this.bar.clef) {
                case Clef.Neutral:
                    offset = this.bar.staff.standardNotationLineCount - 1;
                    break;
                case Clef.F4:
                    offset = 2;
                    break;
                case Clef.C3:
                    offset = 4;
                    break;
                case Clef.C4:
                    offset = 2;
                    break;
                case Clef.G2:
                    offset = 6;
                    break;
            }
            this.createStartSpacing();

            this.addPreBeatGlyph(new ClefGlyph(0, this.getScoreY(offset), this.bar.clef, this.bar.clefOttava));
            this.addPreBeatGlyph(new SpacingGlyph(0, 0, this.smuflMetrics.preBeatGlyphSpacing));
            hasClef = true;
        }
        // Key signature
        if (
            hasClef ||
            (this.index === 0 && this.bar.keySignature !== KeySignature.C) ||
            (this.bar.previousBar &&
                this.bar.keySignature !== this.bar.previousBar.getKeySignatureAt(Number.POSITIVE_INFINITY))
        ) {
            this.createStartSpacing();
            this._createKeySignatureGlyphs();
        }
        // Time Signature
        if (
            !this.bar.previousBar ||
            (this.bar.previousBar &&
                this.bar.masterBar.timeSignatureNumerator !== this.bar.previousBar.masterBar.timeSignatureNumerator) ||
            (this.bar.previousBar &&
                this.bar.masterBar.timeSignatureDenominator !==
                    this.bar.previousBar.masterBar.timeSignatureDenominator) ||
            (this.bar.previousBar &&
                this.bar.masterBar.isFreeTime &&
                this.bar.masterBar.isFreeTime !== this.bar.previousBar.masterBar.isFreeTime)
        ) {
            this.createStartSpacing();
            this._createTimeSignatureGlyphs();
        }
    }

    private _createKeySignatureGlyphs(): void {
        const glyph = this._keySignatureGlyph(
            this.bar.keySignature,
            this.bar.previousBar?.getKeySignatureAt(Number.POSITIVE_INFINITY) ?? 0,
            this.bar.clef
        );
        this.addPreBeatGlyph(glyph);
        if (!glyph.isEmpty) {
            this.addPreBeatGlyph(new SpacingGlyph(0, 0, this.smuflMetrics.preBeatGlyphSpacing));
        }
    }

    private _keySignatureGlyph(
        currentKey: number,
        previousKey: number,
        clef: Clef,
        cancel: number | null = null
    ): KeySignatureGlyph {
        let offsetClef: number = 0;
        switch (clef) {
            case Clef.Neutral:
                offsetClef = 0;
                break;
            case Clef.G2:
                offsetClef = 1;
                break;
            case Clef.F4:
                offsetClef = 3;
                break;
            case Clef.C3:
                offsetClef = 2;
                break;
            case Clef.C4:
                offsetClef = 0;
                break;
        }

        const glyph = new KeySignatureGlyph();
        glyph.gap = this.smuflMetrics.accidentalPadding;
        glyph.renderer = this;

        const newLines: Map<number, boolean> = new Map<number, boolean>();
        const newGlyphs: Glyph[] = [];
        // how many symbols do we need to get from a C-keysignature
        // to the new one
        // var offsetSymbols = (currentKey <= 7) ? currentKey : currentKey - 7;
        // a sharp keysignature
        if (ModelUtils.keySignatureIsSharp(currentKey)) {
            for (let i: number = 0; i < Math.abs(currentKey); i++) {
                const step: number = ScoreBarRenderer._sharpKsSteps[i] + offsetClef;
                newGlyphs.push(new AccidentalGlyph(0, this.getScoreY(step), AccidentalType.Sharp, 1));
                newLines.set(step, true);
            }
        } else {
            for (let i: number = 0; i < Math.abs(currentKey); i++) {
                const step: number = ScoreBarRenderer._flatKsSteps[i] + offsetClef;
                newGlyphs.push(new AccidentalGlyph(0, this.getScoreY(step), AccidentalType.Flat, 1));
                newLines.set(step, true);
            }
        }
        // naturalize previous key if naturalizing
        if (currentKey === KeySignature.C || cancel !== null) {
            const naturalizeKey = cancel ?? previousKey;
            const naturalizeSymbols: number = Math.abs(naturalizeKey);
            const previousKeyPositions = ModelUtils.keySignatureIsSharp(naturalizeKey)
                ? ScoreBarRenderer._sharpKsSteps
                : ScoreBarRenderer._flatKsSteps;
            for (let i: number = 0; i < naturalizeSymbols; i++) {
                const step: number = previousKeyPositions[i] + offsetClef;
                if (!newLines.has(step)) {
                    glyph.addGlyph(
                        new AccidentalGlyph(
                            0,
                            this.getScoreY(previousKeyPositions[i] + offsetClef),
                            AccidentalType.Natural,
                            1
                        )
                    );
                }
            }
        }

        for (const newGlyph of newGlyphs) {
            glyph.addGlyph(newGlyph);
        }

        return glyph;
    }

    protected override createPostBeatGlyphs(): void {
        this._notationGlyphs = [];
        this._hasEndNotationChanges = false;
        const groups = new Map<number, StaffNotationChange[]>();
        for (const change of this.bar.notationChanges ?? []) {
            if (!Number.isFinite(change.displayStart) || change.displayStart <= 0) {
                continue;
            }
            const list = groups.get(change.displayStart) ?? [];
            list.push(change);
            groups.set(change.displayStart, list);
        }
        for (const [displayStart, changes] of groups) {
            const glyph = new LeftToRightLayoutingGlyphGroup();
            glyph.renderer = this;
            let clef: StaffNotationChange | undefined;
            let key: StaffNotationChange | undefined;
            for (const change of changes) {
                if (change.clef !== null) {
                    clef = change;
                }
                if (change.keySignature !== null) {
                    key = change;
                }
            }
            if (clef?.isClefVisible && clef.clef !== null) {
                const offset =
                    clef.clef === Clef.G2
                        ? 6
                        : clef.clef === Clef.C3
                          ? 4
                          : clef.clef === Clef.Neutral
                            ? this.bar.staff.standardNotationLineCount - 1
                            : 2;
                glyph.addGlyph(new ClefGlyph(0, this.getScoreY(offset), clef.clef, clef.clefOttava ?? Ottavia.Regular));
                glyph.addGlyph(new SpacingGlyph(0, 0, this.smuflMetrics.preBeatGlyphSpacing));
            }

            let previousKeyWasVisible = true;
            if (key) {
                for (const previous of this.bar.notationChanges ?? []) {
                    if (previous === key) {
                        break;
                    }
                    if (previous.keySignature !== null) {
                        previousKeyWasVisible = previous.isKeySignatureVisible;
                    }
                }
            }
            // Modes remain part of the timed tonal context but do not change
            // the printed fifths. Keep explicit cancellation, clef changes and
            // hidden-to-visible declarations rather than discarding source ink.
            const isRedundantKey =
                key &&
                !clef &&
                key.cancelKeySignature === null &&
                previousKeyWasVisible &&
                key.keySignature === this.bar.getKeySignatureAt(displayStart - 1e-7);
            if (key?.isKeySignatureVisible && key.keySignature !== null && !isRedundantKey) {
                glyph.addGlyph(
                    this._keySignatureGlyph(
                        key.keySignature,
                        this.bar.getKeySignatureAt(displayStart - 1e-7),
                        this.bar.getClefAt(displayStart),
                        key.cancelKeySignature
                    )
                );
                glyph.addGlyph(new SpacingGlyph(0, 0, this.smuflMetrics.preBeatGlyphSpacing));
            }
            if (glyph.width === 0) {
                continue;
            }
            if (displayStart >= this.bar.masterBar.calculateDuration()) {
                this.addPostBeatGlyph(glyph);
                this._hasEndNotationChanges = true;
            } else {
                this._notationGlyphs.push({ displayStart, glyph });
            }
        }
        super.createPostBeatGlyphs();
    }

    public override _registerLayoutingInfo(): void {
        this.layoutingInfo.alignPostBeatGlyphsRight ||= this._hasEndNotationChanges;
        super._registerLayoutingInfo();
        for (const { displayStart, glyph } of this._notationGlyphs) {
            this.layoutingInfo.addNotationSpacing(this.bar.masterBar.start + displayStart, glyph.width);
        }
    }

    private _createTimeSignatureGlyphs(): void {
        const lines = this.bar.staff.standardNotationLineCount - 1;
        this.addPreBeatGlyph(
            new ScoreTimeSignatureGlyph(
                0,
                this.getScoreY(lines),
                this.bar.masterBar.timeSignatureNumerator,
                this.bar.masterBar.timeSignatureDenominator,
                this.bar.masterBar.timeSignatureCommon,
                this.bar.masterBar.isFreeTime
            )
        );
        this.addPreBeatGlyph(new SpacingGlyph(0, 0, this.smuflMetrics.preBeatGlyphSpacing));
    }

    protected override createVoiceGlyphs(v: Voice): void {
        super.createVoiceGlyphs(v);
        for (const b of v.beats) {
            this.addBeatGlyph(new ScoreBeatContainerGlyph(b));
        }
    }

    public override getNoteLine(note: Note): number {
        return this.accidentalHelper.getNoteSteps(note) / 2;
    }

    public getNoteSteps(n: Note): number {
        return this.accidentalHelper.getNoteSteps(n);
    }

    private readonly _beamDirections = new Map<BeamingHelper, BeamDirection>();

    public override completeBeamingHelper(helper: BeamingHelper) {
        const direction = this._calculateBeamDirection(helper);
        this._beamDirections.set(helper, direction);
    }

    private _calculateBeamDirection(helper: BeamingHelper): BeamDirection {
        // no proper voice (should not happen usually)
        if (!helper.voice) {
            return BeamDirection.Up;
        }
        // we have a preferred direction
        if (helper.preferredBeamDirection !== null) {
            return helper.preferredBeamDirection!;
        }
        // on multi-voice setups secondary voices are always down
        if (helper.voice.index > 0) {
            return this._invertBeamDirection(helper, BeamDirection.Down);
        }
        // on multi-voice setups primary voices are always up
        if (helper.voice.bar.isMultiVoice) {
            return this._invertBeamDirection(helper, BeamDirection.Up);
        }
        // grace notes are always up
        if (helper.beats[0].graceType !== GraceType.None) {
            return this._invertBeamDirection(helper, BeamDirection.Up);
        }

        if (helper.beats.length === 1 && helper.beats[0].slashed) {
            return this._invertBeamDirection(helper, BeamDirection.Down);
        }

        // the average line is used for determination
        //      key lowerequal than middle line -> up
        //      key higher than middle line -> down
        if (helper.highestNoteInHelper && helper.lowestNoteInHelper) {
            // NOTE: This is the only place where we need the locations before we have positioned the notes
            // TODO: we should first register all note-heads and calculate the accidentals+steps
            const highestNotePosition = this._getNoteCenterYBeforeLayouting(helper.highestNoteInHelper);
            const lowestNotePosition = this._getNoteCenterYBeforeLayouting(helper.lowestNoteInHelper);

            const avg = (highestNotePosition + lowestNotePosition) / 2;
            return this._invertBeamDirection(
                helper,
                this.middleYPosition < avg ? BeamDirection.Up : BeamDirection.Down
            );
        }

        return this._invertBeamDirection(helper, BeamDirection.Up);
    }

    private _getNoteCenterYBeforeLayouting(note: Note): number {
        const steps = AccidentalHelper.computeStepsWithoutAccidentals(this.bar, note);
        return this.getScoreY(steps);
    }

    private _invertBeamDirection(helper: BeamingHelper, direction: BeamDirection): BeamDirection {
        if (!helper.invertBeamDirection) {
            return direction;
        }
        switch (direction) {
            case BeamDirection.Down:
                return BeamDirection.Up;
            // case BeamDirection.Up:
            default:
                return BeamDirection.Down;
        }
    }
    protected override shouldPaintBeamingHelper(helper: BeamingHelper): boolean {
        return !helper.beats.some(b => b.sourceBeamGroup !== 0) && super.shouldPaintBeamingHelper(helper);
    }

    protected override paintBeamingStem(
        beat: Beat,
        _cy: number,
        x: number,
        topY: number,
        bottomY: number,
        canvas: ICanvas
    ): void {
        if (!beat.isStemVisible) {
            return;
        }
        using _ = ElementStyleHelper.beat(canvas, BeatSubElement.StandardNotationStem, beat);
        canvas.fillRect(x, topY, this.smuflMetrics.stemThickness, bottomY - topY);
    }
}
