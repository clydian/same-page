import type { PlayerMeasure } from '@same-page/player';
import { useMessages } from '../../i18n';

export function useMeasureLabel() {
  const t = useMessages('practice');
  return (measure: PlayerMeasure | undefined, fallback: string) => {
    if (!measure) return fallback;
    if (measure.number === undefined) return measure.label;
    const values = { measure: measure.number };
    return measure.visit === undefined ? t('printedMeasure', values) : t('repeatedMeasure', { ...values, visit: measure.visit });
  };
}
