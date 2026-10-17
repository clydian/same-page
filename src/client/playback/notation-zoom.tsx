import { Button, DialogTrigger, Popover } from 'react-aria-components';
import { Dialog } from '../navigation/overlays';

export function NotationZoom({ scale, ready, onChange }: { scale: number; ready: boolean; onChange(value: number): void }) {
  return <DialogTrigger>
    <Button className="practice-zoom-trigger" aria-label="谱面大小" isDisabled={!ready}>{Math.round(scale * 100)}%</Button>
    <Popover className="practice-popover practice-zoom-popover" placement="bottom end" offset={6}>
      <Dialog aria-label="调整谱面大小" className="practice-zoom-panel">
        <div className="practice-notation-size" role="group" aria-label="谱面大小">
          <Button className="practice-icon" aria-label="缩小谱面" aria-disabled={scale <= 0.3} onPress={() => { if (scale > 0.3) onChange(scale - 0.1); }}>−</Button>
          <Button className="practice-size-reset" aria-label="恢复默认谱面大小" onPress={() => onChange(0.6)}>{Math.round(scale * 100)}%</Button>
          <Button className="practice-icon" aria-label="放大谱面" aria-disabled={scale >= 1.2} onPress={() => { if (scale < 1.2) onChange(scale + 0.1); }}>+</Button>
        </div>
        <p>双指缩放 · 点击比例恢复默认</p>
      </Dialog>
    </Popover>
  </DialogTrigger>;
}
