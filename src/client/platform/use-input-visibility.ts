import { useEffect, useState } from "react";

/** Keep focused form inputs visible across keyboard, viewport and app changes. */
export function useInputVisibility(layout: "page" | "overlay") {
  // Portaled overlays mount on open, so subscribe when the actual node appears.
  const [container, setContainer] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!container) return;
    const viewport = window.visualViewport;
    let frame: number | undefined;

    const ensureVisible = () => {
      frame = undefined;
      if (document.visibilityState !== "visible") return;
      let top = viewport?.offsetTop ?? 0;
      const height = viewport?.height ?? window.innerHeight;
      if (height <= 0) return;
      // Mobile keyboards can shrink only the visual viewport. A short auth
      // page otherwise has no document scroll range, even for explicit scrolls.
      // A pinch zoom also shrinks the visual viewport. Leave zoomed scrolling
      // to the browser rather than treating that difference as keyboard space.
      const zoomed = (viewport?.scale ?? 1) !== 1;
      if (layout === "page") {
        container.style.setProperty("--input-keyboard-inset", `${zoomed ? 0 : Math.max(0, window.innerHeight - height)}px`);
      } else if (zoomed) {
        container.style.removeProperty("--input-viewport-height");
        container.style.removeProperty("--input-viewport-top");
      } else {
        // A fixed modal cannot be lifted by document scrolling. Fit its overlay
        // and internal scroll area to the visible region instead.
        container.style.setProperty("--input-viewport-height", `${height}px`);
        container.style.setProperty("--input-viewport-top", `${top}px`);
      }
      const input = document.activeElement;
      if (!(input instanceof HTMLInputElement) || !container.contains(input) || input.disabled) return;
      let bounds = input.getBoundingClientRect();
      if (bounds.height <= 0) return;
      if (layout === "overlay" || bounds.top < top || bounds.bottom > top + height) {
        // Nearest scrolling in overlays also checks their internal clipping,
        // which can be smaller than the visual viewport (for example landscape).
        // Native scrolling can pan the visual viewport when scrollY is zero.
        input.scrollIntoView({ block: layout === "page" ? "center" : "nearest", inline: "nearest", behavior: "instant" });
        bounds = input.getBoundingClientRect();
        top = viewport?.offsetTop ?? 0;
      }
      if (zoomed || layout === "overlay") return;
      const gap = Math.min(12, Math.max(0, (height - bounds.height) / 2));
      // scrollIntoView's layout-viewport center may still be behind the keyboard.
      // Use the visual viewport's bounds, including its pan after app switching.
      const delta = bounds.top < top + gap
        ? bounds.top - top - gap
        : Math.max(0, bounds.bottom - (top + height - gap));
      if (Math.abs(delta) > 1) window.scrollBy({ top: delta, behavior: "instant" });
    };
    const schedule = () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(ensureVisible);
    };

    container.addEventListener("focusin", schedule);
    document.addEventListener("visibilitychange", schedule);
    window.addEventListener("focus", schedule);
    window.addEventListener("pageshow", schedule);
    window.addEventListener("resize", schedule);
    viewport?.addEventListener("resize", schedule);
    viewport?.addEventListener("scroll", schedule);
    schedule();
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      container.removeEventListener("focusin", schedule);
      document.removeEventListener("visibilitychange", schedule);
      window.removeEventListener("focus", schedule);
      window.removeEventListener("pageshow", schedule);
      window.removeEventListener("resize", schedule);
      viewport?.removeEventListener("resize", schedule);
      viewport?.removeEventListener("scroll", schedule);
      container.style.removeProperty("--input-keyboard-inset");
      container.style.removeProperty("--input-viewport-height");
      container.style.removeProperty("--input-viewport-top");
    };
  }, [container, layout]);

  return setContainer;
}
