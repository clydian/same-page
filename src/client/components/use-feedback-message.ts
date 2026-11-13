import { useCallback, useEffect, useRef, useState, type FocusEvent } from 'react';

type Message = { text: string | null; duration?: number };
type Options = { duration: number; once?: string };

/** Only explicitly temporary results expire. Errors are persistent by default. */
export function useFeedbackMessage(initial: string | null = null, initialOptions?: Options) {
  const [current, setCurrent] = useState<Message>({ text: initial, duration: initialOptions?.duration });
  const seen = useRef(new Set<string>());
  const [hovered, setHovered] = useState<Message | null>(null);
  const [focused, setFocused] = useState<Message | null>(null);
  const setMessage = useCallback((text: string | null, options?: Options) => {
    if (text && options?.once) {
      if (seen.current.has(options.once)) return;
      seen.current.add(options.once);
    }
    setCurrent({ text, duration: options?.duration });
  }, []);
  const dismiss = useCallback(() => setCurrent(value => ({ text: null, duration: value.duration })), []);
  useEffect(() => {
    if (!current.text || current.duration === undefined || hovered === current || focused === current) return;
    const timer = setTimeout(() => setCurrent(value => value === current ? { text: null } : value), current.duration);
    return () => clearTimeout(timer);
  }, [current, hovered, focused]);
  return {
    message: current.text, temporary: current.duration !== undefined, setMessage, dismiss,
    interaction: {
      onMouseEnter: () => setHovered(current), onMouseLeave: () => setHovered(null),
      onFocusCapture: () => setFocused(current),
      onBlurCapture: (event: FocusEvent<HTMLElement>) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(null); },
    },
  };
}

