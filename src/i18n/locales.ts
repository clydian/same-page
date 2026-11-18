export const sourceLocale = "zh-Hans";
export const localeStorageKey = "same-page:locale";

export const localeNames = {
  "zh-Hans": "简体中文",
  "zh-Hant-TW": "繁體中文",
  en: "English",
  ja: "日本語",
  ko: "한국어",
  "es-419": "Español (Latinoamérica)",
  "pt-BR": "Português (Brasil)",
  de: "Deutsch",
  fr: "Français",
  it: "Italiano",
} as const;

export type AppLocale = keyof typeof localeNames;
export const supportedLocales = Object.keys(localeNames) as AppLocale[];

export function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === "string" && Object.hasOwn(localeNames, value);
}

export function matchLocales(requested: Iterable<string>): AppLocale {
  for (const tag of requested) {
    try {
      const locale = new Intl.Locale(tag);
      if (isAppLocale(locale.baseName)) return locale.baseName;
      const { language } = locale;
      if (language === "zh") return locale.maximize().script === "Hant" ? "zh-Hant-TW" : sourceLocale;
      if (language === "es") return "es-419";
      if (language === "pt") return "pt-BR";
      if (isAppLocale(language)) return language;
    } catch {
      // Ignore invalid language tags and try the remaining preferences.
    }
  }
  return sourceLocale;
}

export function localeFromAcceptLanguage(header?: string | null): AppLocale {
  const ranked = (header ?? "").split(",").map((entry) => {
    const [tag, quality] = entry.trim().split(/\s*;\s*/, 2);
    const weight = quality === undefined ? 1 : Number(/^q=(.+)$/i.exec(quality)?.[1]);
    return { tag, weight };
  });
  return matchLocales(ranked
    .filter(({ weight }) => weight > 0 && weight <= 1)
    .sort((left, right) => right.weight - left.weight)
    .map(({ tag }) => tag));
}
