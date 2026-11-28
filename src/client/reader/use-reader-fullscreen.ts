import { useFeedbackMessage } from "../components/use-feedback-message";
import { useMessages } from "../../i18n";
import { useEffect, useRef, useState } from "react";

// Fullscreen the document so body portals (text input, menus, dialogs) remain
// visible. This reader only exits a fullscreen session it requested itself.
export function useReaderFullscreen() {
  const t = useMessages("reader");
  const practice = useMessages("practice");
  const [active, setActive] = useState(!!document.fullscreenElement);
  const feedback = useFeedbackMessage();
  const owned = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const update = () => {
      setActive(!!document.fullscreenElement);
      if (!document.fullscreenElement) owned.current = false;
    };
    document.addEventListener("fullscreenchange", update);
    return () => {
      mounted.current = false;
      document.removeEventListener("fullscreenchange", update);
      if (owned.current && document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, []);
  const toggle = async () => {
    feedback.dismiss();
    const exiting = Boolean(document.fullscreenElement);
    try {
      if (exiting) await document.exitFullscreen();
      else {
        owned.current = true;
        await document.documentElement.requestFullscreen({ navigationUI: "hide" });
        if (!mounted.current && document.fullscreenElement) await document.exitFullscreen();
      }
    } catch {
      owned.current = false;
      if (!mounted.current) return;
      if (exiting) feedback.setMessage(practice("focusExitFailure"));
      else feedback.setMessage(t("fullScreenUnavailable"), { duration: 8000 });
    }
  };
  return { active, supported: !!document.fullscreenEnabled, feedback, toggle };
}
