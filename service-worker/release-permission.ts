// Public shell metadata only. Never touches the business database.
interface Target { target: string; channel: "stable" | "beta"; intent: string; revision: number; contract: string }
export class ReleasePermission {
  private key: string;
  private cache: string;
  constructor(private origin: string, private buildId: string, private enabled: boolean) {
    this.key = new URL('/__same_page_release_permission__', origin).href;
    this.cache = 'same-page-release-permission-v1:' + encodeURIComponent(origin);
  }
  async target(): Promise<Target> {
    const response = await fetch(new URL('/api/client-release', this.origin), { credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('release_target_unavailable');
    const value = await response.json() as Target;
    if (!/^[a-f0-9]{40}$/.test(value.target) || !['stable','beta'].includes(value.channel) || typeof value.intent !== 'string' || !Number.isSafeInteger(value.revision) || value.contract !== 'same-page-storage-v15-sync-v1') throw new Error('invalid_release_target');
    return value;
  }
  async confirm() {
    if (!this.enabled) return;
    const target = await this.target();
    if (target.target !== this.buildId) throw new Error('release_target_changed');
    return target;
  }
  async activate() {
    if (!this.enabled) return;
    try {
      const target = await this.confirm();
      await (await caches.open(this.cache)).put(this.key, Response.json(target));
    } catch { /* An automatically activated stale candidate gains no display permission. */ }
  }
  async permits(id: string) {
    if (!this.enabled) return true;
    try {
      const response = await (await caches.open(this.cache)).match(this.key);
      const target = response ? await response.json() as Target : null;
      return target?.target === id;
    } catch { return false; }
  }
}
