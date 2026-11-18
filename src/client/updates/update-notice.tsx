import { useMessages } from "../../i18n";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { canApplyUpdate } from "./update-safety";
import { useUpdateStatus } from "./update-status";
import "./update-notice.css";

// One reminder per waiting worker in this page lifetime. Nothing is persisted or
// shared with another user, tab, or future update.
export function UpdateNotice() {
  const t = useMessages("system");
  const status = useUpdateStatus();
  const { pathname } = useLocation();
  const library = /^\/choirs\/[^/]+$/.test(pathname);
  const seen = useRef(new WeakSet<ServiceWorker>());
  const [notice, setNotice] = useState<ServiceWorker | null>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    const deferred = status.deferred;
    if (!library || !deferred) {
      const timer = setTimeout(() => setNotice(null), 0);
      return () => clearTimeout(timer);
    }
    const tick = () => {
      if (!canApplyUpdate(true)) { setNotice(null); return; }
      if (status.phase === "ready" && Date.now() - deferred.since >= 10000 && !seen.current.has(deferred.worker) && canApplyUpdate()) {
        seen.current.add(deferred.worker);
        setHovered(false); setFocused(false);
        setNotice(deferred.worker);
      }
    };
    const timer = setInterval(tick, 500);
    return () => clearInterval(timer);
  }, [library, status.deferred, status.phase]);
  useEffect(() => {
    if (!notice || hovered || focused) return;
    const timer = setTimeout(() => setNotice(null), 8000);
    return () => clearTimeout(timer);
  }, [notice, hovered, focused]);
  if (!library || notice !== status.deferred?.worker) return null;
  return <aside className="update-notice" aria-label={t("updateNotice.label")}
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    onFocusCapture={() => setFocused(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
    <div className="update-notice-copy" role="status" aria-live="polite" aria-atomic="true">
      <strong>{t("updateNotice.ready")}</strong>
      <p>{t("updateNotice.otherWindows")}</p>
    </div>
    <button type="button" className="update-notice-close" aria-label={t("updateNotice.close")} onClick={() => setNotice(null)}><X size={18} aria-hidden="true" /></button>
    <Link to="/about" className="update-notice-link">{t("updateNotice.view")}</Link>
  </aside>;
}
