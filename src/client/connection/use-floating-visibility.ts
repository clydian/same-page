import { useEffect, useRef, useState } from "react";

export function useFloatingVisibility() {
  const [visible, setVisible] = useState(true);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let previous = Math.max(0, window.scrollY), distance = 0;
    const onScroll = () => {
      const current = Math.max(0, Math.min(window.scrollY, document.documentElement.scrollHeight - window.innerHeight));
      const delta = current - previous;
      previous = current;
      if (current <= 24) { distance = 0; setVisible(true); return; }
      if (Math.sign(delta) !== Math.sign(distance)) distance = 0;
      distance += delta;
      if (Math.abs(distance) >= 12) { setVisible(distance < 0 || document.activeElement === button.current); distance = 0; }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return { button, visible };
}
