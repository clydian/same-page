export function loginHref(returnTo: string, panel?: "layers") {
  return `/login?returnTo=${encodeURIComponent(returnTo)}${panel ? `&panel=${panel}` : ""}`;
}

export function loginReturn(search: string) {
  const params = new URLSearchParams(search);
  const target = params.get("returnTo");
  // Only known in-product destinations; never accept an external redirect.
  if (target && /^\/admin(?:\/scores\/[a-zA-Z0-9-]+)?$/.test(target)) return { target, panel: null };
  if (!target || !/^\/choirs\/[a-zA-Z0-9-]+(?:\/(?:scores\/[a-zA-Z0-9-]+|preferences))?$/.test(target)) return null;
  return { target, panel: params.get("panel") === "layers" ? "layers" : null };
}
