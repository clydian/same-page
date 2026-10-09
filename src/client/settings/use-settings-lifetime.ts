import { useEffect, useRef } from "react";

// Each page is keyed by user and drive. Also reject mutations completing after
// unmount (including StrictMode's effect cleanup) instead of publishing feedback.
// A retained view may additionally scope operations to its current writable state.
export function useSettingsLifetime(scope?: unknown) {
  const generation = useRef(0);
  useEffect(() => () => { generation.current += 1; }, [scope]);
  return generation;
}

export function captureSettingsLifetime(lifetime: { current: number }) {
  const generation = lifetime.current;
  return () => generation === lifetime.current;
}

export function invalidateSettingsLifetime(lifetime: { current: number }) {
  lifetime.current += 1;
}
