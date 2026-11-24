import { useMemo } from 'react';
import { useAppLocale } from '../../i18n';

export function useSightSingingScoreFormat() {
  const { locale } = useAppLocale();
  return useMemo(() => new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }), [locale]).format;
}
