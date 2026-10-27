import type { Env } from "../env";

export function connectionOrigins(env: Env): [string, string] | null {
  if (env.CONNECTIONS_ENABLED !== "true" || !env.CONNECTION_BACKUP_ORIGIN) return null;
  try {
    const primary = new URL(env.CONNECTION_PRIMARY_ORIGIN ?? env.BETTER_AUTH_URL);
    const backup = new URL(env.CONNECTION_BACKUP_ORIGIN);
    if ([primary, backup].some(url => url.protocol !== "https:" || url.origin !== url.href.replace(/\/$/, "")) || primary.origin === backup.origin) return null;
    // Credentials use SameSite=Lax. Restrict deployment to sibling hosts;
    // unrelated sites require a different cookie/CSRF design.
    if (primary.hostname.split(".").slice(1).join(".") !== backup.hostname.split(".").slice(1).join(".")) return null;
    return [primary.origin, backup.origin];
  } catch { return null; }
}
