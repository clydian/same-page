import { Button, Tooltip, TooltipTrigger } from 'react-aria-components';

export type NotationZoomProps = { scale: number; ready: boolean; onChange(value: number): void };

// Direct controls stay in the shared floating tool group, including on phones.
export function NotationZoom({ scale, ready, onChange }: NotationZoomProps) {
  return <div className="practice-notation-size" role="group" aria-label="重排字号" aria-description="调整字号会重新排版；双指只放大查看">
    <Button className="practice-icon" aria-label="缩小谱面" aria-disabled={!ready || scale <= 0.3} onPress={() => { if (ready && scale > 0.3) onChange(scale - 0.1); }}>−</Button>
    <TooltipTrigger><Button className="practice-size-reset" aria-label="谱面大小" aria-description={`重排字号 ${Math.round(scale * 100)}%，点击恢复默认字号 60%`} aria-live="polite" aria-atomic="true" isDisabled={!ready} onPress={() => onChange(0.6)}>{Math.round(scale * 100)}%</Button><Tooltip className="practice-tooltip" placement="bottom">重排字号 · 双指仅放大查看</Tooltip></TooltipTrigger>
    <Button className="practice-icon" aria-label="放大谱面" aria-disabled={!ready || scale >= 1.2} onPress={() => { if (ready && scale < 1.2) onChange(scale + 0.1); }}>+</Button>
  </div>;
}
