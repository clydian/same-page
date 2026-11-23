import { Button } from "react-aria-components";
import { useMessages } from "../../i18n";

const tempoUnits = { 4: 'wholeNote', 3: 'dottedHalfNote', 2: 'halfNote', 1.5: 'dottedQuarterNote', .75: 'dottedEighthNote', .25: 'sixteenthNote' } as const;
export function PracticeSpeed({ speed, tempo, ready, setSpeed, compact = false }: { speed: number; tempo?: { bpm: number; unit: number }; ready: boolean; setSpeed(value: number): void; compact?: boolean }) {
  const t = useMessages("practice");
  const unit = tempo?.unit ?? 1;
  const notationSymbol = unit === 1 ? '♩' : unit === .5 ? '♪' : undefined;
  const unitName = tempoUnits[unit as keyof typeof tempoUnits];
  const beat = notationSymbol ?? (unitName ? t(unitName) : t("quarterNoteUnits", { count: unit }));
  const bpm = tempo ? tempo.bpm / unit : undefined;
  const rate = (value: number) => Number(value.toFixed(1)).toString();
  return <section className={compact ? "challenge-speed" : "practice-speed-panel"} aria-label={t("playbackSpeed")}>
    <label className="practice-field"><span>{t("speed")} <output>{speed.toFixed(2)}×</output>{compact && bpm !== undefined && <small>{t("adjustedTempo", { beat, bpm: rate(bpm * speed) })}</small>}</span>
      <input aria-label={t("playbackSpeed")} aria-valuetext={bpm ? t("currentSpeedWithTempo", { speed: speed.toFixed(2), bpm: rate(bpm * speed) }) : t("currentSpeed", { speed: speed.toFixed(2) })} type="range" min="0.5" max="2" step="0.01" value={speed} disabled={!ready} onChange={event => setSpeed(Number(event.target.value))} />
    </label>
    {!compact && bpm !== undefined && <p className="practice-tempo" aria-live="polite">{t("originalTempo", { beat, bpm: rate(bpm) })}<br />{t("adjustedTempo", { beat, bpm: rate(bpm * speed) })}</p>}
    {!compact && <div className="practice-speed-actions">
      <Button className="practice-action" aria-label={t("decreaseSpeed")} isDisabled={!ready || speed <= .5} onPress={() => setSpeed(speed - .01)}>− 0.01</Button>
      <Button className="practice-action" isDisabled={!ready} onPress={() => setSpeed(1)}>{t("resetSpeed")}</Button>
      <Button className="practice-action" aria-label={t("increaseSpeed")} isDisabled={!ready || speed >= 2} onPress={() => setSpeed(speed + .01)}>＋ 0.01</Button>
    </div>}
  </section>;
}
