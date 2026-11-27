import { useEffect, useState, type CSSProperties } from 'react';

const modes = ['app', 'dark', 'light', 'custom'] as const;
export type MonitorAppearance = { mode: typeof modes[number]; background: string; trace: string };
const defaultAppearance: MonitorAppearance = { mode: 'app', background: '#152222', trace: '#98cfc2' };
const storageKey = 'same-page:pitch-monitor:appearance';
function readAppearance(): MonitorAppearance {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null') as Partial<MonitorAppearance> | null;
    if (!saved || !saved.mode || !modes.includes(saved.mode)) return defaultAppearance;
    const safe = (value: unknown, fallback: string) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
    return { mode: saved.mode, background: safe(saved.background, defaultAppearance.background), trace: safe(saved.trace, defaultAppearance.trace) };
  } catch { return defaultAppearance; }
}

export function useMonitorAppearance() {
  const [appearance, setAppearance] = useState(readAppearance);
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(appearance)); } catch { /* The page still works without storage. */ }
  }, [appearance]);
  return [appearance, setAppearance] as const;
}

export function monitorColors(appearance: MonitorAppearance): CSSProperties | undefined {
  if (appearance.mode !== 'custom') return undefined;
  const { background, trace } = appearance;
  const channels = background.slice(1).match(/../g)?.map(hex => {
    const channel = parseInt(hex, 16) / 255;
    return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
  }) ?? [0, 0, 0];
  const light = channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722 > .179;
  return {
    '--pitch-plot-background': background,
    '--pitch-plot-ink': light ? '#000' : '#fff',
    '--pitch-plot-trace': trace,
    '--pitch-plot-chromatic-opacity': .15,
    '--pitch-plot-scale-opacity': .34,
  } as CSSProperties;
}
