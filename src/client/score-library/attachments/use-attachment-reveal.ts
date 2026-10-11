import { useLayoutEffect, useRef } from "react";

export type AttachmentRevealRequest = { scoreId: string; scope: string; scrollY: number };

// Only explicit expansion requests reveal content. Restored lists and later
// refreshes must leave the user's reading position alone.
export function useAttachmentReveal(request: AttachmentRevealRequest | undefined, onHandled?: (request: AttachmentRevealRequest) => void) {
  const list = useRef<HTMLUListElement>(null);
  useLayoutEffect(() => {
    if (!request) return;
    const frame = requestAnimationFrame(() => {
      const fab = document.querySelector<HTMLButtonElement>(".upload-fab");
      if (list.current && fab && fab.dataset.visible !== "false" && Math.abs(window.scrollY - request.scrollY) < 1) {
        const obstacle = fab.getBoundingClientRect();
        let distance = 0;
        for (const action of list.current.querySelectorAll<HTMLElement>("button, a")) {
          const rect = action.getBoundingClientRect();
          if (rect.right > obstacle.left && rect.left < obstacle.right && rect.bottom > obstacle.top && rect.top < obstacle.bottom) {
            distance = Math.max(distance, rect.bottom - obstacle.top + 8);
          }
        }
        // Instant movement also respects reduced motion and avoids a moving
        // click target while a smooth scroll is still in flight.
        if (distance > 0) window.scrollBy({ top: distance, behavior: "instant" });
      }
      // This component only mounts once metadata is ready. Empty results
      // finish the intent too, so a later refresh cannot replay it.
      onHandled?.(request);
    });
    return () => cancelAnimationFrame(frame);
  }, [request, onHandled]);
  return list;
}
