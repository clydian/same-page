export function createInviteLink(origin: string, code: string) {
  const url = new URL("/", origin);
  url.searchParams.set("join", "1");
  url.hash = new URLSearchParams({ invite: code }).toString();
  return url.href;
}

export function readInviteLink(hash: string): { code: string | null } | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  if (!params.has("invite")) return null;
  const code = (params.get("invite") ?? "").toUpperCase().replace(/-/g, "");
  return { code: params.getAll("invite").length === 1 && /^[A-HJ-NP-Z2-9]{8}$/.test(code) ? code : null };
}

export function readScannedInvite(value: string, origin: string): string | null {
  try {
    const url = new URL(value);
    if (url.origin !== origin || url.username || url.password || url.pathname !== "/") return null;
    if (url.searchParams.getAll("join").length !== 1 || url.searchParams.get("join") !== "1") return null;
    return readInviteLink(url.hash)?.code ?? null;
  } catch { return null; }
}
