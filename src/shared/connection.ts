export const connectionRoutes = ["direct", "backup"] as const;
export type ConnectionRoute = typeof connectionRoutes[number];
export type ConnectionMode = "auto" | ConnectionRoute;

// A path selects an entry, not an identity or trusted proxy header. ESA keeps
// the upstream Host/SNI canonical, so inferring the public host is unreliable.
export const connectionPrefix = "/api/_entry/";
export function connectionPath(route: ConnectionRoute, path: string) {
  return `${connectionPrefix}${route}${path.slice(4)}`;
}

// These flows establish/recover identity and must remain usable after expiry.
// Session inspection and sensitive mutations are deliberately separate.
export function establishesIdentity(path: string) {
  return path.startsWith("/api/auth/sign-in/") || path.startsWith("/api/auth/callback/") || [
    "/api/auth/flow", "/api/auth/registration/request-otp", "/api/auth/registration/complete",
    "/api/auth/email-otp/request-password-reset", "/api/auth/email-otp/check-verification-otp",
    "/api/auth/email-otp/reset-password", "/api/auth/request-password-reset", "/api/auth/reset-password",
  ].includes(path);
}

export function isPublicConnectionPath(path: string) {
  return establishesIdentity(path) || ["/api/auth/get-session", "/api/auth/social-providers"].includes(path)
    || /^\/api\/(?:connection\/|guest\/|health$|diagnostic-reports$|android-release)/.test(path);
}
