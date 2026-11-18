import { Languages } from "lucide-react";
import { useAppLocale, useMessages } from "./context";
import { isAppLocale, localeNames, supportedLocales } from "./locales";
import "./language-select.css";

export function LanguageSelect() {
  const { locale, setLocale, requestedLocale, loadFailed } = useAppLocale();
  const t = useMessages("language");
  return <label className="app-language-select">
    <Languages size={18} aria-hidden="true" />
    <select aria-label={t("label")} aria-busy={requestedLocale !== null} value={requestedLocale ?? locale} onChange={(event) => {
      if (isAppLocale(event.target.value)) setLocale(event.target.value);
    }}>
      {supportedLocales.map((option) =>
        <option key={option} value={option} lang={option}>{localeNames[option]}</option>
      )}
    </select>
    {loadFailed && <span className="app-language-error" role="status">{t("loadFailed")}</span>}
  </label>;
}
