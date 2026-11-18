import { useMessages } from "../../i18n";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useLayoutEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { useApplicationIdentity } from "../auth/application-identity";
import { appearanceOwnerKey, readAppearance, saveAppearance, subscribeAppearance, type AppearancePreferences, type PaperTheme } from "./appearance-store";
import "./appearance.css";

import { AppearanceContext, useAppearance } from "./appearance-context";
const subscribeSystem = (listener: () => void) => {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
};
const systemIsDark = () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
export function AppearanceProvider({ children }: { children: ReactNode }) {
  const identity = useApplicationIdentity();
  const location = useLocation();
  const experience = new URLSearchParams(location.search).get("experience") === "1";
  const owner = identity.localUserId ? `${experience ? "experience" : "user"}:${identity.localUserId}` : "guest";
  const preferences = useSyncExternalStore(subscribeAppearance, () => readAppearance(owner));
  const systemDark = useSyncExternalStore(subscribeSystem, systemIsDark);
  const dark = preferences.interfaceTheme === "dark" || preferences.interfaceTheme === "system" && systemDark;
  const paper = dark ? preferences.darkPaper : preferences.lightPaper;
  useLayoutEffect(() => {
    // Keep the bootstrapped theme while IndexedDB recovers an offline user.
    if (identity.restoring) return;
    const root = document.documentElement;
    root.dataset.uiTheme = dark ? "dark" : "light";
    root.dataset.paperTheme = paper;
    root.dataset.invertAnnotations = String(preferences.invertAnnotations);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#000000" : "#014653");
    try { localStorage.setItem(appearanceOwnerKey, owner); } catch { /* Optional first-paint hint. */ }
  }, [dark, paper, preferences.invertAnnotations, owner, identity.restoring]);
  return <AppearanceContext value={{ preferences, owner, dark }}>{children}</AppearanceContext>;
}
export function AppearanceSettings() {
  const t = useMessages("system");
  const { preferences, owner, dark } = useAppearance();
  const [error, setError] = useState(false);
  const change = (patch: Partial<AppearancePreferences>) => setError(!saveAppearance(owner, { ...readAppearance(owner), ...patch }));
  return <section className="appearance-settings" aria-label={t("appearance.settings")}>
    <header className="appearance-heading">
      <p>{owner.startsWith("experience:") ? t("appearance.guestAppearance") : t("appearance.deviceScope")}</p>
    </header>
    <div className="appearance-panel">
      <fieldset className="appearance-fieldset" aria-label={t("appearance.interfaceTheme")}>
        <legend>{t("appearance.interfaceTheme")}</legend>
        <div className="appearance-segments">
          {([{ value: "system", label: t("appearance.followSystem"), icon: Monitor }, { value: "light", label: t("appearance.light"), icon: Sun }, { value: "dark", label: t("appearance.dark"), icon: Moon }] as const).map(({ value, label, icon: Icon }) => <label className="appearance-segment" key={value}>
            <input type="radio" name="interface-theme" value={value} checked={preferences.interfaceTheme === value} onChange={() => change({ interfaceTheme: value })} />
            <span><Icon size={17} aria-hidden="true" />{label}</span>
          </label>)}
        </div>
      </fieldset>
      <div className="appearance-paper-section">
        <div className="appearance-section-heading"><h3>{t("appearance.scoreAppearance")}</h3><p>{t("appearance.automaticTheme")}</p></div>
        <div className="appearance-paper-groups">
          <PaperChoices label={t("appearance.lightScore")} title={t("appearance.lightTheme")} name="light-paper" value={preferences.lightPaper} active={!dark} invertAnnotations={preferences.invertAnnotations} onChange={lightPaper => change({ lightPaper })} />
          <PaperChoices label={t("appearance.darkScore")} title={t("appearance.darkTheme")} name="dark-paper" value={preferences.darkPaper} active={dark} invertAnnotations={preferences.invertAnnotations} onChange={darkPaper => change({ darkPaper })} />
        </div>
      </div>
      <fieldset className="appearance-fieldset appearance-annotations" aria-label={t("appearance.invertedNotes")}>
        <legend>{t("appearance.invertedNotes")}</legend>
        <div className="appearance-segments">
          {([{ value: false, label: t("appearance.keepNoteColors") }, { value: true, label: t("appearance.invertNoteColors") }] as const).map(({ value, label }) => <label className="appearance-segment" key={label}>
            <input type="radio" name="annotation-appearance" checked={preferences.invertAnnotations === value} onChange={() => change({ invertAnnotations: value })} />
            <span><i className="appearance-note-dot" data-inverted={value || undefined} aria-hidden="true" />{label}</span>
          </label>)}
        </div>
        <p className="appearance-field-help">{t("appearance.noteColorsHelp")}</p>
      </fieldset>
    </div>
    <p className="appearance-footnote">{t("appearance.inversionHelp")}</p>
    {error && <p role="status">{t("appearance.unsaved")}</p>}
  </section>;
}

function PaperChoices({ label, title, name, value, active, invertAnnotations, onChange }: {
  label: string; title: string; name: string; value: PaperTheme; active: boolean; invertAnnotations: boolean; onChange(value: PaperTheme): void;
}) {
  const t = useMessages("system");
  return <fieldset className="appearance-fieldset appearance-paper-group" aria-label={label}>
    <legend>{title}{active && <span className="appearance-current">{t("appearance.current")}</span>}</legend>
    <div className="appearance-paper-options">
      {([{ value: "original", label: t("appearance.original") }, { value: "soft", label: t("appearance.soft") }, { value: "inverted", label: t("appearance.inverted") }] as const).map(option => <label className="appearance-paper-option" key={option.value}>
        <input type="radio" name={name} aria-label={`${label}：${option.label}`} checked={value === option.value} onChange={() => onChange(option.value)} />
        <span className="appearance-paper-preview" data-paper={option.value} aria-hidden="true">
          <svg viewBox="0 0 100 64" fill="none"><g className="appearance-preview-score" stroke="currentColor" strokeWidth=".65">
            {[23, 27, 31, 35, 39].map(y => <path key={y} d={`M12 ${y}H88`} />)}
            <path d="M30 34V15M53 30V11M76 26V7" strokeWidth="1.2" />
          </g><g className="appearance-preview-score" fill="currentColor"><ellipse cx="27" cy="34" rx="3.6" ry="2.4" transform="rotate(-20 27 34)" /><ellipse cx="50" cy="30" rx="3.6" ry="2.4" transform="rotate(-20 50 30)" /><ellipse cx="73" cy="26" rx="3.6" ry="2.4" transform="rotate(-20 73 26)" /></g>
          <path className="appearance-preview-note" data-inverted={option.value === "inverted" && invertAnnotations || undefined} d="M39 48Q48 43 59 47" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </span>
        <span className="appearance-paper-caption">{option.label}<Check size={13} aria-hidden="true" /></span>
      </label>)}
    </div>
  </fieldset>;
}
