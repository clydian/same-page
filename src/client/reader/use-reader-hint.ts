import { useEffect, useState } from "react";

// Optional hints share the same once-per-device lifecycle. They never require
// dismissal before the score or tools can be used.
export function useReaderHint(key: string, enabled = true, duration = 5000) {
  const [visible, setVisible] = useState(() => {
    try { return localStorage.getItem(key) !== "true"; } catch { return true; }
  });
  useEffect(() => {
    if (!enabled || !visible) return;
    try { localStorage.setItem(key, "true"); } catch { /* Optional device preference. */ }
    const timer = window.setTimeout(() => setVisible(false), duration);
    return () => window.clearTimeout(timer);
  }, [key, enabled, visible, duration]);
  return { visible: enabled && visible, dismiss: () => setVisible(false), show: () => setVisible(true) };
}

