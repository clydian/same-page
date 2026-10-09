// Navigation keeps the local owner's display while confirming an online session.
// A new effective session still clears private reads; local ownership grants no authority.
export const NAVIGATION_FRESH_MS = 60_000;
const resets = new Set<() => void>();
export type DriveReadKind = "settings" | "management" | "permission-contacts" | "memberships" | "usage" | "shared-layers" | "shared-layer" | "layer-access" | "reading-defaults";
// In-memory identity only: never parse owner/drive/variant strings as dependencies.
export interface DriveReadIdentity {
  owner: string | null;
  driveId: string;
  kind: DriveReadKind;
  variant?: string;
}
export interface DriveChangeImpact {
  driveId: string;
  dropAuthority: boolean;
  directory: boolean;
  affects(identity: DriveReadIdentity): boolean;
}
const changes = new Set<(impact: DriveChangeImpact) => void>();
let session: string | null | undefined;
let sessionOwner: string | null = null;
let sessionState = { paused: false, revision: 0 };
const sessionChanges = new Set<() => void>();
const suspensions = new Set<() => void>();
export const navigationSessionSnapshot = () => sessionState;
export function onNavigationSessionChange(listener: () => void) { sessionChanges.add(listener); return () => { sessionChanges.delete(listener); }; }
export function onNavigationSuspend(listener: () => void) { suspensions.add(listener); }

let epoch = 0;
export const captureNavigationIdentity = () => { const captured = epoch; return () => captured === epoch; };
export function onNavigationReset(listener: () => void) { resets.add(listener); }
export function onDriveChange(listener: (impact: DriveChangeImpact) => void) { changes.add(listener); return () => { changes.delete(listener); }; }
// Consumers execute their own invalidation lifecycle; endpoint dependency
// knowledge stays here, including the display-name directory exception.
function invalidateNavigationDrive(driveId: string, permissions: boolean, resource: string) {
  const targets: Partial<Record<string, readonly DriveReadKind[]>> = {
    scores: ["usage"],
    name: ["settings", "management"],
    "display-name": ["settings", "permission-contacts", "memberships"],
    "shared-layers": ["management", "shared-layers", "shared-layer", "layer-access", "reading-defaults"],
  };
  const kinds = targets[resource.split("/")[0]] ?? [];
  const impact: DriveChangeImpact = {
    driveId,
    dropAuthority: permissions,
    directory: permissions || resource !== "display-name",
    affects: identity => identity.driveId === driveId && (permissions || resource === "purge" || kinds.includes(identity.kind)),
  };
  for (const listener of changes) listener(impact);
}
export function resetNavigation() { epoch++; for (const listener of resets) listener(); }
export function observeNavigationSession(next: string | null, owner: string | null = null, temporary = false) {
  // Local ownership keeps presentation stable; it never restores cloud authority.
  const sameOwner = owner !== null && sessionOwner === owner;
  if (next === null && temporary && sameOwner) {
    if (!sessionState.paused) {
      epoch++;
      for (const listener of suspensions) listener();
      sessionState = { paused: true, revision: sessionState.revision + 1 };
      for (const listener of sessionChanges) listener();
    }
    return;
  }
  if (session === next && sessionOwner === owner && sessionState.paused === temporary) return;
  const reconfirming = sameOwner && sessionState.paused && next !== null && (session === null || session === next);
  session = next;
  sessionOwner = owner;
  if (!reconfirming) resetNavigation();
  sessionState = { paused: temporary, revision: sessionState.revision + 1 };
  for (const listener of sessionChanges) listener();
}
export function observeNavigationResponse(input: RequestInfo | URL, init: RequestInit | undefined, response: Response) {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const path = new URL(url, "https://same-page.invalid").pathname;
  const match = /^\/api\/choirs\/([^/]+)\/(.+)$/.exec(path);
  if (!match) return;
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  const permissions = response.status === 401 || response.status === 403;
  // Reads retain their endpoint-specific denial semantics; a failed mutation
  // invalidates remembered capabilities, without declaring the drive deleted.
  if (method === "GET" || method === "HEAD" || (!response.ok && !permissions)) return;
  const resource = match[2];
  if (/^scores\/[^/]+\/(annotations|layers|preferences)(\/|$)/.test(resource)) return;
  if (!/^(name|display-name|memberships|ownership|shared-layers|scores|purge)(\/|$)/.test(resource)) return;
  invalidateNavigationDrive(match[1], permissions || /^(memberships|ownership)(\/|$)/.test(resource), resource);
}
