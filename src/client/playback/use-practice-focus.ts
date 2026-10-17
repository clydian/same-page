import { useEffect, useRef, useState } from 'react';

// Decide once per session. Rotation and browser chrome changes must never close
// a menu, interrupt a scrub, or hide the control that currently owns focus.
export function usePracticeFocus(embedded?: boolean) {
  const [bottomCollapsed, updateBottomCollapsed] = useState(() => !embedded && window.innerWidth > window.innerHeight);
  const preference = useRef(bottomCollapsed);
  const setBottomCollapsed = (value: boolean) => { preference.current = value; updateBottomCollapsed(value); };
  const [focused, setFocused] = useState(false);
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState(false);
  const ownsFullscreen = useRef(false);
  const mounted = useRef(true);
  const supported = typeof document.documentElement.requestFullscreen === 'function' && document.fullscreenEnabled === true;
  const restore = () => {
    setFocused(false);
    updateBottomCollapsed(preference.current);
    setNotice('');
  };
  useEffect(() => {
    mounted.current = true;
    const changed = () => {
      if (ownsFullscreen.current && !document.fullscreenElement) {
        ownsFullscreen.current = false;
        restore();
      }
    };
    document.addEventListener('fullscreenchange', changed);
    return () => {
      mounted.current = false;
      document.removeEventListener('fullscreenchange', changed);
      if (ownsFullscreen.current && document.fullscreenElement === document.documentElement) void document.exitFullscreen().catch(() => {});
    };
  }, []);
  const exit = async () => {
    if (pending) return;
    if (ownsFullscreen.current && document.fullscreenElement) {
      setPending(true);
      try { await document.exitFullscreen(); ownsFullscreen.current = false; restore(); }
      catch { setNotice('无法退出全屏，请使用浏览器的返回或退出全屏操作。'); }
      finally { if (mounted.current) setPending(false); }
    } else restore();
  };
  const enter = async () => {
    if (pending) return;
    setFocused(true); updateBottomCollapsed(true);
    if (!supported) {
      setNotice('已进入专注模式。此浏览器不能全屏显示谱面，系统状态栏由系统保留。');
      return;
    }
    if (document.fullscreenElement) return; // Preserve fullscreen owned by another surface.
    // Call directly from the press gesture, before awaiting anything.
    setPending(true); ownsFullscreen.current = true;
    try {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      if (!mounted.current && ownsFullscreen.current && document.fullscreenElement === document.documentElement) {
        ownsFullscreen.current = false;
        await document.exitFullscreen();
      }
    }
    catch {
      ownsFullscreen.current = false;
      if (mounted.current) setNotice('全屏未能开启，已使用专注模式；无法强行隐藏系统状态栏。');
    } finally { if (mounted.current) setPending(false); }
  };
  return { bottomCollapsed, setBottomCollapsed, focused, notice, dismissNotice: () => setNotice(''), pending, supported, enter, exit };
}
