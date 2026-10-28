import type { InstallProgress } from '../src/shared/update-progress';

type Asset = { url: string; bytes: number };
export class InstallProgressTracker {
  private stage: InstallProgress['stage'] = 'checking';
  private completed = new Map<string, { bytes: number; reused: boolean }>();
  private received = new Map<string, number>();
  constructor(private buildId: string, private totalBytes: number, private publish: (progress: Omit<InstallProgress, 'sequence'>) => void) { this.emit(); }
  receive(entry: Asset, bytes: number) {
    if (this.stage === 'verifying' || this.stage === 'ready') return;
    if (!Number.isSafeInteger(bytes) || bytes < 0) return;
    // Presentation cannot change the transport/integrity policy. Bound observed
    // reception by the sealed entry size; actual validation remains independent.
    this.stage = 'downloading'; this.received.set(entry.url, Math.min(bytes, entry.bytes)); this.emit();
  }
  prepared(entry: Asset, reused: boolean) {
    if (this.stage === 'verifying' || this.stage === 'ready') return;
    this.completed.set(entry.url, {bytes:entry.bytes,reused}); this.emit();
  }
  finish(stage: 'verifying' | 'ready') { this.stage = stage; this.emit(); }
  private emit() {
    const completed = [...this.completed.values()];
    this.publish({buildId:this.buildId,stage:this.stage,totalBytes:this.totalBytes,
      preparedBytes:completed.reduce((n,e)=>n+e.bytes,0),reusedBytes:completed.filter(e=>e.reused).reduce((n,e)=>n+e.bytes,0),
      downloadedBytes:[...this.received.values()].reduce((n,bytes)=>n+bytes,0)});
  }
}
