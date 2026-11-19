import { expect, test } from "vitest";
import { localeFromAcceptLanguage, matchLocales } from "../src/i18n/locales.ts";

test("uses the first supported preference and matches regional variants", () => {
  expect(matchLocales(["nl-NL", "de-AT", "en-GB"])).toBe("de");
  expect(localeFromAcceptLanguage("de-AT;q=0.6, zh-HK;q=0.9")).toBe("zh-Hant-TW");
});

test("falls back to English when no preference matches", () => {
  expect(matchLocales(["nl-NL", "ru-RU"])).toBe("en");
  expect(localeFromAcceptLanguage("nl-NL, ru-RU;q=0.5")).toBe("en");
  expect(matchLocales([])).toBe("en");
});
