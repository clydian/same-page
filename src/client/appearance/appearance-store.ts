export type InterfaceTheme = "system" | "light" | "dark";
export type PaperTheme = "original" | "soft" | "inverted";
export type AppearancePreferences = {
  interfaceTheme: InterfaceTheme;
  lightPaper: PaperTheme;
  darkPaper: PaperTheme;
  invertAnnotations: boolean;
};
export const defaultAppearance: AppearancePreferences = {
  interfaceTheme: "system", lightPaper: "original", darkPaper: "soft", invertAnnotations: false,
};
const prefix = "same-page:appearance:";
export const appearanceOwnerKey = "same-page:appearance-owner";
const listeners = new Set<() => void>();
const cache = new Map<string, { raw: string | null; value: AppearancePreferences }>();
const volatile = new Map<string, AppearancePreferences>();

export function parseAppearance(raw: string | null): AppearancePreferences {
  try {
    const value = JSON.parse(raw ?? "null");
    if (!value || typeof value !== "object") return defaultAppearance;
    const paper = (candidate: unknown, fallback: PaperTheme): PaperTheme =>
      candidate === "original" || candidate === "soft" || candidate === "inverted" ? candidate : fallback;
    return {
      interfaceTheme: value.interfaceTheme === "light" || value.interfaceTheme === "dark" ? value.interfaceTheme : "system",
      lightPaper: paper(value.lightPaper, "original"), darkPaper: paper(value.darkPaper, "soft"),
      invertAnnotations: value.invertAnnotations === true,
    };
  } catch { return defaultAppearance; }
}
export function readAppearance(owner: string): AppearancePreferences {
  if (volatile.has(owner)) return volatile.get(owner)!;
  let raw: string | null = null;
  try { raw = localStorage.getItem(prefix + owner); } catch { /* Display works without browser storage. */ }
  const saved = cache.get(owner);
  if (saved && saved.raw === raw) return saved.value;
  const value = parseAppearance(raw); cache.set(owner, { raw, value }); return value;
}
export function saveAppearance(owner: string, value: AppearancePreferences): boolean {
  let saved = true;
  try { localStorage.setItem(prefix + owner, JSON.stringify(value)); volatile.delete(owner); }
  catch { volatile.set(owner, value); saved = false; }
  listeners.forEach(listener => listener());
  return saved;
}
export function subscribeAppearance(listener: () => void) {
  listeners.add(listener);
  const storage = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith(prefix)) {
      if (event.key === null) volatile.clear(); else volatile.delete(event.key.slice(prefix.length));
      listener();
    }
  };
  window.addEventListener("storage", storage);
  return () => { listeners.delete(listener); window.removeEventListener("storage", storage); };
}
export function clearUserAppearance(userId: string) {
  for (const owner of [`user:${userId}`, `experience:${userId}`]) {
    localStorage.removeItem(prefix + owner); volatile.delete(owner); cache.delete(owner);
  }
  localStorage.removeItem(appearanceOwnerKey);
  listeners.forEach(listener => listener());
}
