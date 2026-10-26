export const connectionRoutes = ["direct", "backup"] as const;
export type ConnectionRoute = typeof connectionRoutes[number];
export type ConnectionMode = "auto" | ConnectionRoute;

// A path selects an entry, not an identity or trusted proxy header. ESA keeps
// the upstream Host/SNI canonical, so inferring the public host is unreliable.
export const connectionPrefix = "/api/_entry/";
export function connectionPath(route: ConnectionRoute, path: string) {
  return `${connectionPrefix}${route}${path.slice(4)}`;
}
