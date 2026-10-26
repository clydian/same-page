import { useId, useState, type ReactNode } from 'react';
import { Button, Dialog, DialogTrigger, Popover, Switch } from 'react-aria-components';
import { CircleHelp } from 'lucide-react';

export function PracticeHelp({ title, children }: { title: string; children: ReactNode }) {
  return <DialogTrigger><Button className="practice-help-button" aria-label={`${title}说明`}><CircleHelp size={16} aria-hidden="true" /></Button><Popover className="practice-feature-help" placement="top" offset={6}><Dialog aria-label={`${title}说明`}><strong>{title}</strong><p>{children}</p><Button slot="close" className="practice-action">知道了</Button></Dialog></Popover></DialogTrigger>;
}
export function PracticeSetting({ title, help, selected, disabled, onChange }: { title: string; help: ReactNode; selected: boolean; disabled?: boolean; onChange(value: boolean): void }) {
  return <div className="practice-setting-row"><span className="practice-setting-name">{title}</span><PracticeHelp title={title}>{help}</PracticeHelp><Switch className="practice-switch" aria-label={title} isSelected={selected} isDisabled={disabled} onChange={onChange}><span className="practice-switch-state" aria-hidden="true">{selected ? '开' : '关'}</span><span className="practice-switch-track" aria-hidden="true" /></Switch></div>;
}

export function PracticeDisclosure({ title, help, children }: { title: string; help: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return <section className="practice-disclosure"><div className="practice-setting-row"><Button className="practice-disclosure-trigger" aria-expanded={open} aria-controls={id} onPress={() => setOpen(!open)}><span>{title}</span><span className="practice-disclosure-arrow" aria-hidden="true">{open ? '⌃' : '⌄'}</span></Button><PracticeHelp title={title}>{help}</PracticeHelp></div>{open && <div id={id} className="practice-setting-content practice-mixer">{children}</div>}</section>;
}

export function PracticeVolume({ title, value, disabled, onChange }: { title: string; value: number; disabled?: boolean; onChange(value: number): void }) {
  return <label className="practice-field practice-volume-control"><span className="practice-control-label"><span>{title}</span><span className="practice-control-value">{Math.round(value * 100)}<small>%</small></span></span><input aria-label={`${title}音量`} type="range" min="0" max="1" step=".05" value={value} disabled={disabled} onChange={event => onChange(Number(event.target.value))} /></label>;
}
