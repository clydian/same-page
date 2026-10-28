import { useLayoutEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { useApplicationIdentity } from "../auth/application-identity";
import { appearanceOwnerKey, readAppearance, saveAppearance, subscribeAppearance, type AppearancePreferences } from "./appearance-store";
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
  const owner = experience ? `experience:${identity.localUserId ?? "guest"}` : identity.localUserId ? `user:${identity.localUserId}` : "guest";
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
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#172321" : "#014653");
    try { localStorage.setItem(appearanceOwnerKey, owner); } catch { /* Optional first-paint hint. */ }
  }, [dark, paper, preferences.invertAnnotations, owner, identity.restoring]);
  return <AppearanceContext value={{ preferences, owner, dark }}>{children}</AppearanceContext>;
}
export function AppearanceSettings() {
  const { preferences, owner } = useAppearance();
  const [error, setError] = useState(false);
  const change = (patch: Partial<AppearancePreferences>) => setError(!saveAppearance(owner, { ...readAppearance(owner), ...patch }));
  return <section className="appearance-settings" aria-labelledby="appearance-title">
    <h2 id="appearance-title">外观</h2>
    <p className="settings-copy">仅保存在本机，应用于所有云盘和乐谱。</p>
    <label className="appearance-setting"><span>界面主题</span><select value={preferences.interfaceTheme} onChange={event => change({ interfaceTheme: event.target.value as AppearancePreferences["interfaceTheme"] })}>
      <option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option>
    </select></label>
    {(["lightPaper", "darkPaper"] as const).map((key) => <label className="appearance-setting" key={key}><span>{key === "lightPaper" ? "浅色界面下的谱面" : "深色界面下的谱面"}</span><select value={preferences[key]} onChange={event => change({ [key]: event.target.value })}>
      <option value="original">原始</option><option value="soft">柔和</option><option value="inverted">反色</option>
    </select></label>)}
    <label className="appearance-setting"><span>谱面反色时的批注</span><select value={preferences.invertAnnotations ? "invert" : "preserve"} onChange={event => change({ invertAnnotations: event.target.value === "invert" })}>
      <option value="preserve">颜色不变</option><option value="invert">跟随反色</option>
    </select></label>
    <p className="settings-copy">反色会改变彩色原谱、封面和插图的显示颜色，可切回原始。批注选项仅在谱面反色时生效；不改变保存或导出的颜色。</p>
    {error && <p role="status">外观已在本次使用中生效，但无法保存到本机。</p>}
  </section>;
}
