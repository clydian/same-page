import { applicationShellReleaseLimitBytes } from './update-diagnostics';

export interface InstallProgress {
  buildId: string;
  sequence: number;
  stage: 'checking' | 'downloading' | 'verifying' | 'ready';
  totalBytes: number;
  preparedBytes: number;
  reusedBytes: number;
  downloadedBytes: number;
}
// Progress is presentation only. It never grants display/update permission.
export function parseInstallProgress(value: unknown): InstallProgress | null {
  if (!value || typeof value !== 'object') return null;
  const p = value as InstallProgress;
  if (typeof p.buildId !== 'string' || !/^(?:[a-f0-9]{7,40}|development)$/.test(p.buildId) ||
    !Number.isSafeInteger(p.sequence) || p.sequence < 1 ||
    !['checking', 'downloading', 'verifying', 'ready'].includes(p.stage) ||
    ![p.totalBytes, p.preparedBytes, p.reusedBytes, p.downloadedBytes].every(n => Number.isSafeInteger(n) && n >= 0) ||
    p.totalBytes === 0 || p.totalBytes > applicationShellReleaseLimitBytes ||
    p.preparedBytes > p.totalBytes || p.reusedBytes > p.preparedBytes || p.downloadedBytes + p.reusedBytes > p.totalBytes ||
    (p.stage === 'ready' && p.preparedBytes !== p.totalBytes)) return null;
  return {buildId:p.buildId,sequence:p.sequence,stage:p.stage,totalBytes:p.totalBytes,preparedBytes:p.preparedBytes,reusedBytes:p.reusedBytes,downloadedBytes:p.downloadedBytes};
}
