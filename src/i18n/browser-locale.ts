import { isAppLocale, localeStorageKey, matchLocales, sourceLocale, type AppLocale } from "./locales";

let currentLocale: AppLocale = sourceLocale;

export function getCurrentLocale(): AppLocale {
  return currentLocale;
}

export function getInitialLocale(): AppLocale {
  if (typeof window === "undefined") return sourceLocale;
  try {
    const stored = window.localStorage.getItem(localeStorageKey);
    if (isAppLocale(stored)) return stored;
    if (window.localStorage.getItem("same-page:appearance-owner")) return sourceLocale;
  } catch { /* The locale still works when local storage is unavailable. */ }
  const { languages, language } = window.navigator;
  return matchLocales(languages?.length ? languages : [language]);
}

export function applyLocale(locale: AppLocale) {
  currentLocale = locale;
  document.documentElement.lang = locale;
}

export function rememberLocale(locale: AppLocale) {
  try { window.localStorage.setItem(localeStorageKey, locale); }
  catch { /* Keep the current session in the selected language. */ }
}
