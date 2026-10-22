import { readReleaseReceipt, writeReleaseReceipt, releaseSelectionLock } from "../src/shared/release-receipt";
import type { ReleaseTarget } from "../src/shared/release-channels";
// One public registry record coordinates selection, recovery and display permission.
export class ReleasePermission {
  constructor(private origin: string, private buildId: string, private enabled: boolean) {}
  async target(): Promise<ReleaseTarget> {
    const response = await fetch(new URL('/api/client-release', this.origin), { credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('release_target_unavailable');
    const value = await response.json() as ReleaseTarget;
    if (!/^[a-f0-9]{40}$/.test(value.target) || !['stable','beta'].includes(value.channel) || typeof value.intent !== 'string' || !Number.isSafeInteger(value.revision) || value.contract !== 'same-page-storage-v15-sync-v1') throw new Error('invalid_release_target');
    return value;
  }
  async confirm() {
    if (!this.enabled) return;
    const target = await this.target();
    if (target.target !== this.buildId) throw new Error('release_target_changed');
    return target;
  }
  private async locked<T>(fn: () => Promise<T>) {
    return navigator.locks ? navigator.locks.request(releaseSelectionLock, fn) : fn();
  }
  async displayed(id: string) {
    if (!this.enabled) return;
    await this.locked(async () => {
      const prior = await readReleaseReceipt(this.origin);
      let target: ReleaseTarget;
      try { target = await this.target(); }
      catch { if (prior.permitted?.target === id) return; throw new Error('release_not_permitted'); }
      if (target.target !== id) {
        if (prior.permitted?.target === id && prior.permitted.channel === target.channel) return;
        throw new Error('release_target_changed');
      }
      const matches = (value?: ReleaseTarget) => value?.target === id && value.channel === target.channel &&
        value.intent === target.intent && value.revision === target.revision && value.backend === target.backend;
      if (!prior.pending && matches(prior.confirmed) && matches(prior.permitted)) return;
      // No pending choice can be committed by silence. Server readback wins after interruption.
      try { await writeReleaseReceipt(this.origin, { confirmed: target, permitted: target }); }
      catch (error) {
        // Refreshing metadata must not make an already permitted healthy shell unreadable.
        // A new build or channel still needs its first durable display permission.
        if (prior.permitted?.target !== id || prior.permitted.channel !== target.channel) throw error;
      }
    });
  }
  async activate() {
    if (!this.enabled) return true;
    try { await this.displayed(this.buildId); return true; }
    catch { return false; /* A stale automatic activation never gains display permission. */ }
  }
  async permits(id: string) {
    if (!this.enabled) return true;
    try {
      // Existing open documents may keep running. Every NEW navigation consults
      // the Cookie authority; an expired beta Cookie cannot resurrect a beta shell.
      if (navigator.onLine !== false) {
        try {
          const target = await this.target();
          if (target.target === id) return true;
          const prior = await readReleaseReceipt(this.origin);
          return prior.permitted?.target === id && prior.permitted.channel === target.channel;
        } catch { /* offline/service failure: last committed display only */ }
      }
      return (await readReleaseReceipt(this.origin)).permitted?.target === id;
    } catch { return false; }
  }
}
