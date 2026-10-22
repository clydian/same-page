import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";

// Only a single downward touch starting at the document's top owns refresh.
// Ordinary scrolling, horizontal movement, multiple contacts and overlays do not.
export function PullToRefresh({ children, onRefresh, disabled = false }: {
  children: ReactNode; onRefresh(): void | Promise<unknown>; disabled?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [distance, setDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const canStart = useEffectEvent(() => !disabled && !refreshing && !document.querySelector('[role="dialog"], [role="menu"]'));
  const refresh = useEffectEvent(async (signal: AbortSignal) => {
    setRefreshing(true); setError(false);
    try { await onRefresh(); }
    catch { if (!signal.aborted) setError(true); }
    finally { if (!signal.aborted) setRefreshing(false); }
  });
  useEffect(() => {
    const element = container.current!;
    const controller = new AbortController();
    const previous = document.documentElement.style.overscrollBehaviorY;
    document.documentElement.style.overscrollBehaviorY = "contain";
    let start: { x: number; y: number } | null = null;
    let pulled = 0;
    let interrupted = false;
    const cancel = () => { start = null; pulled = 0; setDistance(0); };
    const begin = (event: TouchEvent) => {
      if (event.touches.length !== 1) { interrupted = true; cancel(); return; }
      if (interrupted || window.scrollY > 0 || !canStart()) return;
      const target = event.target;
      if (target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"]')) return;
      start = { x: event.touches[0].clientX, y: event.touches[0].clientY };
    };
    const move = (event: TouchEvent) => {
      if (!start) return;
      if (event.touches.length !== 1 || !canStart()) { interrupted = true; cancel(); return; }
      const dx = event.touches[0].clientX - start.x;
      const dy = event.touches[0].clientY - start.y;
      if (dy < 0 || Math.abs(dx) > Math.max(14, dy) || window.scrollY > 0) { cancel(); return; }
      if (dy < 10) return;
      if (!event.cancelable) { cancel(); return; }
      event.preventDefault();
      pulled = Math.min(72, dy / 2);
      setDistance(pulled);
    };
    const end = (event: TouchEvent) => {
      const ready = !interrupted && event.touches.length === 0 && pulled >= 54 && canStart();
      interrupted = event.touches.length > 0;
      cancel();
      if (ready) void refresh(controller.signal);
    };
    const abort = (event: TouchEvent) => { interrupted = event.touches.length > 0; cancel(); };
    element.addEventListener("touchstart", begin, { passive: true });
    element.addEventListener("touchmove", move, { passive: false });
    element.addEventListener("touchend", end);
    element.addEventListener("touchcancel", abort);
    return () => {
      controller.abort();
      document.documentElement.style.overscrollBehaviorY = previous;
      element.removeEventListener("touchstart", begin); element.removeEventListener("touchmove", move);
      element.removeEventListener("touchend", end); element.removeEventListener("touchcancel", abort);
    };
  }, []);
  return <div ref={container} className="pull-refresh-area">
    <div className="pull-refresh-status" data-refreshing={refreshing || undefined} style={{ height: refreshing ? 44 : distance }} role="status">
      {(refreshing || distance > 0) && <><RefreshCw size={18} aria-hidden="true" /><span>{refreshing ? "正在刷新乐谱列表…" : distance >= 54 ? "松开刷新" : "下拉刷新"}</span></>}
    </div>
    {error && <p role="alert" className="pull-refresh-error">暂时无法更新乐谱列表，请稍后重试。</p>}
    {children}
  </div>;
}
