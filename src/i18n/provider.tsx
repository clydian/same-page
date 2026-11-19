import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { I18nProvider } from "react-aria";
import { applyLocale, rememberLocale } from "./browser-locale";
import { loadLocale } from "./catalogs";
import { AppLocaleContext } from "./context";
import { sourceLocale, type AppLocale } from "./locales";
import { getMessages } from "./messages";

export function AppLocaleProvider({ children, initialLocale = sourceLocale, initialLoadFailed = false }: {
  children: ReactNode;
  initialLocale?: AppLocale;
  initialLoadFailed?: boolean;
}) {
  const [locale, selectLocale] = useState(initialLocale);
  const [requestedLocale, setRequestedLocale] = useState<AppLocale | null>(null);
  const [loadFailed, setLoadFailed] = useState(initialLoadFailed);
  const latestRequest = useRef(0);

  useLayoutEffect(() => {
    applyLocale(locale);
    document.title = getMessages(locale, "common")("appTitle");
  }, [locale]);

  function setLocale(next: AppLocale) {
    const request = ++latestRequest.current;
    setLoadFailed(false);
    if (next === locale) {
      setRequestedLocale(null);
      rememberLocale(next);
      return;
    }

    setRequestedLocale(next);
    void loadLocale(next).then((loaded) => {
      if (request !== latestRequest.current) return;
      setRequestedLocale(null);
      if (!loaded) {
        setLoadFailed(true);
        return;
      }
      applyLocale(next);
      rememberLocale(next);
      selectLocale(next);
    });
  }

  return <AppLocaleContext value={{ locale, setLocale, requestedLocale, loadFailed }}>
    <I18nProvider locale={locale}>{children}</I18nProvider>
  </AppLocaleContext>;
}
