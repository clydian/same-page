import { createContext, useContext } from "react";
import type { AppFeature } from "./catalog-keys";
import { sourceLocale, type AppLocale } from "./locales";
import { getMessages } from "./messages";

export const AppLocaleContext = createContext<{
  locale: AppLocale;
  setLocale: (locale: AppLocale) => void;
  requestedLocale: AppLocale | null;
  loadFailed: boolean;
}>({
  locale: sourceLocale,
  setLocale: () => {},
  requestedLocale: null,
  loadFailed: false,
});

export function useAppLocale() {
  return useContext(AppLocaleContext);
}

export function useMessages<Feature extends AppFeature>(feature: Feature) {
  return getMessages(useAppLocale().locale, feature);
}
