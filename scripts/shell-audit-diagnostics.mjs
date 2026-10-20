// Keep lifecycle audit failures explicit. The snapshot is collected from a
// fixed allowlist in verify-shell-lifecycle; it contains no cookies or HTML.
export function requireShellAuditResult(result) {
  if (result?.missingAuditTarget) {
    throw new Error('Missing service worker audit target: ' + JSON.stringify(result.missingAuditTarget));
  }
  if (!result?.identity) throw new Error('Missing service worker audit identity');
  return result;
}
