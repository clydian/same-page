import type { ReactNode } from "react";
import {
  createTranslator,
  type MarkupTranslationValues,
  type RichTranslationValues,
  type TranslationValues,
} from "use-intl/core";
import type { AppFeature, AppMessageKey } from "./catalog-keys";
import { availableLocale, featureCatalog } from "./catalogs";
import { sourceLocale, type AppLocale } from "./locales";

type CheckedMessageKey<Key extends string, KnownKeys extends string> =
  Key & (string extends Key ? unknown : KnownKeys);

type Translator<KnownKeys extends string = string> = {
  <Key extends string>(key: CheckedMessageKey<Key, KnownKeys>, values?: TranslationValues): string;
  has(key: string): key is KnownKeys;
  rich<Key extends string>(key: CheckedMessageKey<Key, KnownKeys>, values?: RichTranslationValues): ReactNode;
  markup<Key extends string>(key: CheckedMessageKey<Key, KnownKeys>, values?: MarkupTranslationValues): string;
  raw<Key extends string>(key: CheckedMessageKey<Key, KnownKeys>): unknown;
};

function translator(locale: AppLocale, feature: AppFeature): Translator {
  // The bundle discovers catalog keys at build time, while callers supply
  // dotted key paths. The catalog check validates these message values in CI.
  return createTranslator({
    locale,
    messages: featureCatalog(locale, feature),
  }) as unknown as Translator;
}

const translators = new Map<string, Translator>();

export function getMessages<Feature extends AppFeature>(locale: AppLocale, feature: Feature): Translator<AppMessageKey<Feature>>;
export function getMessages(requestedLocale: AppLocale, feature: AppFeature): Translator {
  const locale = availableLocale(requestedLocale);
  const id = `${locale}:${feature}`;
  const existing = translators.get(id);
  if (existing) return existing;
  const active = translator(locale, feature);
  if (locale === sourceLocale) {
    translators.set(id, active);
    return active;
  }
  const fallback = translator(sourceLocale, feature);
  const forKey = (key: string) => active.has(key) ? active : fallback;
  const translate: Translator = Object.assign(
    (key: string, values?: Parameters<Translator>[1]) => forKey(key)(key, values),
    {
      has: (key: string): key is string => active.has(key) || fallback.has(key),
      rich: (key: string, values?: Parameters<Translator["rich"]>[1]) => forKey(key).rich(key, values),
      markup: (key: string, values?: Parameters<Translator["markup"]>[1]) => forKey(key).markup(key, values),
      raw: (key: string) => forKey(key).raw(key),
    },
  );
  translators.set(id, translate);
  return translate;
}
