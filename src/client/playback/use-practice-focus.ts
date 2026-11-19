import { useMessages } from "../../i18n";
import { useCallback, useEffect, useRef, useState } from 'react';
import { useFeedbackMessage } from '../components/use-feedback-message';

// Decide once per session. Rotation and browser chrome changes must never close
// a menu, interrupt a scrub, or hide the control that currently owns focus.
export function usePracticeFocus(embedded?: boolean) {
  const [controlsCollapsed, updateControlsCollapsed] = useState(() => !embedded && window.innerWidth > window.innerHeight);
  const [toolsCollapsed, updateToolsCollapsed] = useState(controlsCollapsed);
  const toolsPreference = useRef(toolsCollapsed);
  const setToolsCollapsed = (value: boolean) => { toolsPreference.current = value; updateToolsCollapsed(value); };
  const preference = useRef(controlsCollapsed);
  const setControlsCollapsed = (value: boolean) => { preference.current = value; updateControlsCollapsed(value); };
  const [focused, setFocused] = useState(false);
  const t = useMessages("practice");
  const feedback = useFeedbackMessage('');
  const { message: notice, setMessage: setNotice } = feedback;
  const [pending, setPending] = useState(false);
  const ownsFullscreen = useRef(false);
  const mounted = useRef(true);
  const supported = typeof document.documentElement.requestFullscreen === 'function' && document.fullscreenEnabled === true;
  const restore = useCallback(() => {
    setFocused(false);
    updateControlsCollapsed(preference.current);
    updateToolsCollapsed(toolsPreference.current);
    setNotice('');
  }, [setNotice]);
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
  }, [restore]);
  const exit = async () => {
    if (pending) return;
    if (ownsFullscreen.current && document.fullscreenElement) {
      setPending(true);
      try { await document.exitFullscreen(); ownsFullscreen.current = false; restore(); }
      catch { setNotice(t("focusExitFailure")); }
      finally { if (mounted.current) setPending(false); }
    } else restore();
  };
  const enter = async () => {
    if (pending) return;
    setFocused(true); updateControlsCollapsed(true); updateToolsCollapsed(true);
    if (!supported) {
      setNotice(t("focusWithoutFullscreen"), { duration: 8000, once: 'focus-compatibility' });
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
      if (mounted.current) setNotice(t("focusFullscreenFailure"), { duration: 8000, once: 'focus-compatibility' });
    } finally { if (mounted.current) setPending(false); }
  };
  return { toolsCollapsed, setToolsCollapsed, controlsCollapsed, setControlsCollapsed, focused, notice, feedback, dismissNotice: feedback.dismiss, pending, supported, enter, exit };
}

export type PracticeFocus = ReturnType<typeof usePracticeFocus>;
