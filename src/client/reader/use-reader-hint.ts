import { useEffect, useState } from "react";

// Timed hints expire automatically; a manual guide is remembered on dismissal.
export function useReaderHint(key: string, enabled = true, duration: number | null = 5000) {
  const [visible, setVisible] = useState(() => {
    try { return localStorage.getItem(key) !== "true"; } catch { return true; }
  });
  useEffect(() => {
    if (!enabled || !visible || duration === null) return;
    try { localStorage.setItem(key, "true"); } catch { /* Optional device preference. */ }
    const timer = window.setTimeout(() => setVisible(false), duration);
    return () => window.clearTimeout(timer);
  }, [key, enabled, visible, duration]);
  return { visible: enabled && visible, dismiss: () => { setVisible(false); try { localStorage.setItem(key, "true"); } catch { /* Optional device preference. */ } }, show: () => setVisible(true) };
}

