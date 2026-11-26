import { useMessages } from "../../i18n";
import { Button, Tooltip, TooltipTrigger } from 'react-aria-components';
import './notation-zoom.css';

export type NotationZoomProps = { scale: number; ready: boolean; onChange(value: number): void; defaultScale?: number; pinchHint?: boolean };

export function NotationZoom({ scale, ready, onChange, defaultScale = .6, pinchHint = true }: NotationZoomProps) {
  const t = useMessages("practice");
  const percent = Math.round(scale * 100);
  const reset = <Button className="practice-size-reset" aria-label={t("scoreSize")}
    aria-description={t("resetReflowSize", { percent, defaultPercent: Math.round(defaultScale * 100) })}
    aria-live="polite" aria-atomic="true" isDisabled={!ready} onPress={() => onChange(defaultScale)}>{percent}%</Button>;
  return <div className="practice-notation-size" role="group" aria-label={t("reflowSize")} aria-description={pinchHint ? t("reflowSizingDetails") : undefined}>
    <Button className="practice-icon" aria-label={t("zoomOut")} aria-disabled={!ready || scale <= .3} onPress={() => { if (ready && scale > .3) onChange(Math.max(.3, (percent - 10) / 100)); }}>−</Button>
    {pinchHint ? <TooltipTrigger>{reset}<Tooltip className="practice-tooltip" placement="bottom">{t("reflowSizingShort")}</Tooltip></TooltipTrigger> : reset}
    <Button className="practice-icon" aria-label={t("zoomIn")} aria-disabled={!ready || scale >= 1.2} onPress={() => { if (ready && scale < 1.2) onChange(Math.min(1.2, (percent + 10) / 100)); }}>+</Button>
  </div>;
}
