export const createDriveHref = "/drives?create=1";

type ReaderLoginIntent = {
  page?: number;
  panel?: "layers";
  action?: "annotate" | "open";
};

export function loginHref(returnTo: string, reader?: ReaderLoginIntent) {
  const params = new URLSearchParams({ returnTo });
  if (reader?.page) params.set("page", String(reader.page));
  if (reader?.panel) params.set("panel", reader.panel);
  if (reader?.action) params.set("action", reader.action);
  return `/login?${params}`;
}

export function loginReturn(search: string): { target: string; reader?: ReaderLoginIntent } | null {
  const params = new URLSearchParams(search);
  const target = params.get("returnTo");
  if (!target) return null;
  // The destination must be a known internal route. Reader intent never grants access.
  if (target === createDriveHref || /^\/admin(?:\/scores\/[a-zA-Z0-9-]+)?$/.test(target)) return { target };
  if (!/^\/choirs\/[a-zA-Z0-9-]+(?:\/(?:scores\/[a-zA-Z0-9-]+|preferences))?$/.test(target)) return null;
  if (!target.includes("/scores/")) return { target };
  const page = Number(params.get("page"));
  const action = params.get("action");
  return {
    target,
    reader: {
      page: Number.isSafeInteger(page) && page > 0 ? page : undefined,
      panel: params.get("panel") === "layers" ? "layers" : undefined,
      action: action === "annotate" || action === "open" ? action : undefined,
    },
  };
}
