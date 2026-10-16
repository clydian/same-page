import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { adminSession } from "./api";
export function ProductAdminLink({ userId }: { userId: string | null }) {
  const [authorized, setAuthorized] = useState<string | null>(null);
  useEffect(() => {
    const c = new AbortController();
    if (userId)
      void adminSession(c.signal)
        .then(() => {
          if (!c.signal.aborted) setAuthorized(userId);
        })
        .catch(() => {
          if (!c.signal.aborted) setAuthorized(null);
        });
    return () => c.abort();
  }, [userId]);
  return authorized && authorized === userId ? (
    <Link className="settings-secondary-link" to="/admin">
      产品后台<span aria-hidden="true">›</span>
    </Link>
  ) : null;
}
