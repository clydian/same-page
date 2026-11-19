import { useMessages } from "../../i18n";
import { Button, Tooltip, TooltipTrigger } from 'react-aria-components';

export type NotationZoomProps = { scale: number; ready: boolean; onChange(value: number): void };

// Direct controls stay in the shared floating tool group, including on phones.
export function NotationZoom({ scale, ready, onChange }: NotationZoomProps) {
  const t = useMessages("practice");
  return <div className="practice-notation-size" role="group" aria-label={t("reflowSize")} aria-description={t("reflowSizingDetails")}>
    <Button className="practice-icon" aria-label={t("zoomOut")} aria-disabled={!ready || scale <= 0.3} onPress={() => { if (ready && scale > 0.3) onChange(scale - 0.1); }}>−</Button>
    <TooltipTrigger><Button className="practice-size-reset" aria-label={t("scoreSize")} aria-description={t("resetReflowSize", { percent: Math.round(scale * 100) })} aria-live="polite" aria-atomic="true" isDisabled={!ready} onPress={() => onChange(0.6)}>{Math.round(scale * 100)}%</Button><Tooltip className="practice-tooltip" placement="bottom">{t("reflowSizingShort")}</Tooltip></TooltipTrigger>
    <Button className="practice-icon" aria-label={t("zoomIn")} aria-disabled={!ready || scale >= 1.2} onPress={() => { if (ready && scale < 1.2) onChange(scale + 0.1); }}>+</Button>
  </div>;
}
