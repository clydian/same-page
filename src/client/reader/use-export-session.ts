import { useEffect, useState } from "react";
import { ExportSession, type ExportTarget } from "./export-session";

// ExportDialog keys this adapter by the immutable target. Source replacement is
// also a new lifetime; changing the initial layer projection is not.
export function useExportSession(target: ExportTarget) {
  const [initialTarget] = useState(target);
  const [current, setCurrent] = useState<{ session: ExportSession; source: ExportTarget["source"]; snapshot: ReturnType<ExportSession["getSnapshot"]> } | null>(null);
  useEffect(() => {
    const session = new ExportSession({ ...initialTarget, source: target.source });
    const unsubscribe = session.subscribe(() => setCurrent({ session, source: target.source, snapshot: session.getSnapshot() }));
    session.start();
    return () => { unsubscribe(); session.dispose(); };
  }, [initialTarget, target.source]);
  return current?.source === target.source ? current : null;
}
