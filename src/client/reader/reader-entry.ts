// All reader entry points carry the same local-experience intent, including
// attachment playback. The server independently verifies that intent.
export function readerHref(target: { choirId: string; scoreId: string; experience: boolean }, search = "") {
  const query = new URLSearchParams(search);
  if (target.experience) query.set("experience", "1");
  else query.delete("experience");
  const suffix = query.toString();
  return `/choirs/${encodeURIComponent(target.choirId)}/scores/${encodeURIComponent(target.scoreId)}${suffix ? `?${suffix}` : ""}`;
}
