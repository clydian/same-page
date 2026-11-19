import type { AbstractIntlMessages } from "use-intl/core";
import type { AppFeature } from "./catalog-keys";
import { sourceLocale, type AppLocale } from "./locales";

type CatalogPack = Record<string, AbstractIntlMessages>;
const source = import.meta.glob<AbstractIntlMessages>(
  "/src/i18n/messages/zh-Hans/{common,entry,language,library,practice,reader,system}.json",
  { eager: true, import: "default" },
);
const loaders = import.meta.glob<CatalogPack>("./packs/*.ts", { import: "default" });
const catalogs = new Map<AppLocale, CatalogPack>([[sourceLocale, source]]);
const pending = new Map<AppLocale, Promise<boolean>>();
const localeLoadTimeoutMs = 5000;

export function availableLocale(locale: AppLocale): AppLocale {
  return catalogs.has(locale) ? locale : sourceLocale;
}

export function featureCatalog(locale: AppLocale, feature: AppFeature): AbstractIntlMessages {
  return catalogs.get(locale)?.[`/src/i18n/messages/${locale}/${feature}.json`] ?? {};
}

export function loadLocale(locale: AppLocale): Promise<boolean> {
  if (catalogs.has(locale)) return Promise.resolve(true);
  const existing = pending.get(locale);
  if (existing) return existing;
  const load = loaders[`./packs/${locale}.ts`];
  if (!load) return Promise.resolve(false);

  const download = load().then((catalog) => {
    catalogs.set(locale, catalog);
    return true;
  }, () => false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), localeLoadTimeoutMs);
  });
  // Keep the app usable when a request stalls. A late successful import still
  // makes that language available on the next selection.
  const loading = Promise.race([download, deadline]).finally(() => {
    clearTimeout(timer);
    pending.delete(locale);
  });
  pending.set(locale, loading);
  return loading;
}
