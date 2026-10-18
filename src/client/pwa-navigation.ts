export const navigationFallbackDenylist = [/^\/api(?:\/|$)/];

export function isApiPath(pathname: string) {
  try { return navigationFallbackDenylist.some(pattern => pattern.test(decodeURIComponent(pathname))); }
  catch { return true; } // Malformed URLs must reach the server, not the shell.
}
