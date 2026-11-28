import { useState } from "react";
import { captureReadIdentity } from "../settings/read-resource";
import { captureSettingsLifetime, useSettingsLifetime } from "../settings/use-settings-lifetime";

export function useTrashRestore(writable: boolean) {
  const lifetime = useSettingsLifetime(writable);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const reread = () => setAttempt(value => value + 1);

  async function runRestore(
    operation: (isCurrent: () => boolean) => Promise<void>,
    onError: () => void,
  ) {
    if (!writable) return;
    const sameIdentity = captureReadIdentity();
    const sameLifetime = captureSettingsLifetime(lifetime);
    // Callers check again after each await that can precede a visible change.
    const isCurrent = () => sameIdentity() && sameLifetime();
    setBusy(true);
    try {
      await operation(isCurrent);
    } catch {
      if (isCurrent()) onError();
    } finally {
      setBusy(false);
      if (!isCurrent()) reread();
    }
  }

  return { lifetime, busy, attempt, reread, runRestore };
}
