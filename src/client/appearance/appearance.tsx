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
  const { preferences, owner, dark } = useAppearance();
  const [error, setError] = useState(false);
  const change = (patch: Partial<AppearancePreferences>) => setError(!saveAppearance(owner, { ...readAppearance(owner), ...patch }));
  return <section className="appearance-settings" aria-label="外观设置">
    <header className="appearance-heading">
      <p>{owner.startsWith("experience:") ? "体验外观，与登录用户的选择分别保存" : "仅此设备 · 应用于所有云盘与乐谱"}</p>
    </header>
    <div className="appearance-panel">
      <fieldset className="appearance-fieldset" aria-label="界面主题">
        <legend>界面主题</legend>
        <div className="appearance-segments">
          {([{ value: "system", label: "跟随系统", icon: Monitor }, { value: "light", label: "浅色", icon: Sun }, { value: "dark", label: "深色", icon: Moon }] as const).map(({ value, label, icon: Icon }) => <label className="appearance-segment" key={value}>
            <input type="radio" name="interface-theme" value={value} checked={preferences.interfaceTheme === value} onChange={() => change({ interfaceTheme: value })} />
            <span><Icon size={17} aria-hidden="true" />{label}</span>
          </label>)}
        </div>
      </fieldset>
      <div className="appearance-paper-section">
        <div className="appearance-section-heading"><h3>谱面外观</h3><p>随浅色、深色界面自动切换</p></div>
        <div className="appearance-paper-groups">
          <PaperChoices label="浅色界面下的谱面" title="浅色界面" name="light-paper" value={preferences.lightPaper} active={!dark} invertAnnotations={preferences.invertAnnotations} onChange={lightPaper => change({ lightPaper })} />
          <PaperChoices label="深色界面下的谱面" title="深色界面" name="dark-paper" value={preferences.darkPaper} active={dark} invertAnnotations={preferences.invertAnnotations} onChange={darkPaper => change({ darkPaper })} />
        </div>
      </div>
      <fieldset className="appearance-fieldset appearance-annotations" aria-label="谱面反色时的笔记">
        <legend>谱面反色时的笔记</legend>
        <div className="appearance-segments">
          {([{ value: false, label: "颜色不变" }, { value: true, label: "跟随反色" }] as const).map(({ value, label }) => <label className="appearance-segment" key={label}>
            <input type="radio" name="annotation-appearance" checked={preferences.invertAnnotations === value} onChange={() => change({ invertAnnotations: value })} />
            <span><i className="appearance-note-dot" data-inverted={value || undefined} aria-hidden="true" />{label}</span>
          </label>)}
        </div>
        <p className="appearance-field-help">仅影响反色谱面的显示，保存与导出保留原色。</p>
      </fieldset>
    </div>
    <p className="appearance-footnote">反色也会改变原谱中的彩色内容与封面；需要时可切回原始。</p>
    {error && <p role="status">外观已在本次使用中生效，但无法保存到本机。</p>}
  </section>;
}

function PaperChoices({ label, title, name, value, active, invertAnnotations, onChange }: {
  label: string; title: string; name: string; value: PaperTheme; active: boolean; invertAnnotations: boolean; onChange(value: PaperTheme): void;
}) {
  return <fieldset className="appearance-fieldset appearance-paper-group" aria-label={label}>
    <legend>{title}{active && <span className="appearance-current">当前使用</span>}</legend>
    <div className="appearance-paper-options">
      {([{ value: "original", label: "原始" }, { value: "soft", label: "柔和" }, { value: "inverted", label: "反色" }] as const).map(option => <label className="appearance-paper-option" key={option.value}>
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
