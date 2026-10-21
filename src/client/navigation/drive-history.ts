type Entry = { key: string; path: string; context: number };
export function driveForPath(path: string) { return /^\/choirs\/([^/]+)(?:\/|$)/.exec(path)?.[1] ?? null; }

// Switching a drive retires its tasks, but keeps ordinary parent/forward history
// inside the current drive. Unknown older entries fall back at that history slot
// rather than pushing another redirect (which would trap the system Back key).
export class DriveHistory {
  entries: Entry[] = [];
  index = -1;
  private drive: string | null = null;
  private context = 0;
  constructor(initialKey?: string) {
    if (!initialKey) return;
    try {
      const saved = JSON.parse(sessionStorage.getItem("same-page:drive-history-v1") ?? "null");
      if (!saved || typeof saved.drive !== "string" || !Number.isSafeInteger(saved.context) || !Array.isArray(saved.entries) || saved.entries.length > 128) return;
      if (!saved.entries.every((entry: Entry) => typeof entry.key === "string" && typeof entry.path === "string" && entry.path.startsWith("/") && Number.isSafeInteger(entry.context))) return;
      const index = saved.entries.findIndex((entry: Entry) => entry.key === initialKey);
      if (index < 0) return;
      this.entries = saved.entries; this.index = index; this.drive = saved.drive; this.context = saved.context;
    } catch { /* Optional tab history must never block navigation. */ }
  }
  private remember() {
    try {
      const start = Math.max(0, this.index - 64);
      // Only route paths, never invitation queries/fragments or content.
      const entries = this.entries.slice(start, start + 128).map(entry => ({ ...entry, path: entry.path.split(/[?#]/)[0] }));
      sessionStorage.setItem("same-page:drive-history-v1", JSON.stringify({ drive: this.drive, context: this.context, entries }));
    } catch { /* The in-memory boundary still works when storage is blocked. */ }
  }
  obsolete(key: string, path: string, action: string) {
    if (action !== "POP" || !this.drive || !driveForPath(path)) return false;
    const entry = this.entries.find(entry => entry.key === key);
    return driveForPath(path) !== this.drive || Boolean(entry && entry.context !== this.context);
  }
  observe(key: string, path: string, action: string) {
    const drive = driveForPath(path);
    if (drive && (this.index < 0 || action !== "POP" && drive !== this.drive)) { this.drive = drive; this.context++; }
    const index = this.entries.findIndex(entry => entry.key === key);
    const entry = { key, path, context: this.context };
    if (index >= 0) this.index = index;
    else if (action === "REPLACE" && this.index >= 0) this.entries[this.index] = entry;
    else { this.entries.splice(this.index + 1); this.entries.push(entry); this.index = this.entries.length - 1; }
    this.remember();
  }
  skip(key: string) {
    const target = this.entries.findIndex(entry => entry.key === key);
    if (target < 0 || target === this.index) return null;
    const direction = target < this.index ? -1 : 1;
    for (let index = target + direction; index >= 0 && index < this.entries.length; index += direction) {
      const entry = this.entries[index];
      if (!driveForPath(entry.path) || entry.context === this.context) return index - target;
    }
    return null;
  }
  parent(path: string) {
    for (let index = this.index - 1; index >= 0; index--) {
      const entry = this.entries[index];
      if (entry.path === path && (!driveForPath(path) || entry.context === this.context)) return index - this.index;
    }
    return null;
  }
}
