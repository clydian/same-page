import type { ScoreSummary } from "../../shared/scores";
import { diagnosticFetch, pdfFailureCategory } from "../diagnostics/diagnostics";
import { connections, connectionsEnabled } from "../connection/connection";
import { untilAborted } from "../platform/abortable";
import { sha256Hex } from "./offline-score-verification";

export type ScorePdfProgress = { loadedBytes: number; totalBytes: number };
type Download = {
  ownerKey: string;
  controller: AbortController;
  promise: Promise<ArrayBuffer>;
  progress: ScorePdfProgress | null;
  listeners: Set<(progress: ScorePdfProgress) => void>;
  references: number;
};
const downloads = new Map<string, Download>();

export function revokeScorePdfDownloads(userId: string) {
  for (const [key, download] of downloads) {
    if (download.ownerKey === `user:${userId}` || download.ownerKey === `experience:user:${userId}`) {
      download.controller.abort(); downloads.delete(key);
    }
  }
}

// Online opening and offline saving own separate leases on the same immutable
// bytes. Releasing an open must not interrupt an explicit save's lease.
export function acquireScorePdf(ownerKey: string, score: ScoreSummary, onProgress?: (progress: ScorePdfProgress) => void, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const version = score.currentVersion;
  const key = JSON.stringify([ownerKey, score.choirId, score.id, version.id, version.sizeBytes, version.sha256]);
  let download = downloads.get(key);
  if (!download || download.controller.signal.aborted) {
    const controller = new AbortController();
    const listeners = new Set<(progress: ScorePdfProgress) => void>();
    const entry: Download = {
      ownerKey, controller, listeners, references: 0,
      progress: null,
      promise: Promise.resolve(new ArrayBuffer(0)),
    };
    entry.promise = untilAborted(downloadPdf(score, controller.signal, progress => {
      entry.progress = progress;
      for (const listener of listeners) listener(progress);
    }), controller.signal).catch(error => {
      if (downloads.get(key) === entry) downloads.delete(key);
      throw error;
    });
    downloads.set(key, entry);
    download = entry;
  }
  const entry = download;
  entry.references++;
  if (onProgress) { entry.listeners.add(onProgress); if (entry.progress) onProgress(entry.progress); }
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    signal?.removeEventListener("abort", release);
    if (onProgress) entry.listeners.delete(onProgress);
    if (--entry.references === 0) {
      if (downloads.get(key) === entry) downloads.delete(key);
      entry.controller.abort();
    }
  };
  signal?.addEventListener("abort", release, { once: true });
  return {
    promise: signal ? untilAborted(entry.promise, signal) : entry.promise,
    release,
  };
}

async function downloadPdf(score: ScoreSummary, signal: AbortSignal, progress: (progress: ScorePdfProgress) => void) {
  const route = connections.getSnapshot().active;
  try { return await readPdf(score, signal, progress); }
  catch (error) {
    // Keep the reader's existing one-time media recovery, including failures
    // while streaming the body after a successful connection setup.
    if (signal.aborted || !connectionsEnabled || pdfFailureCategory(error) !== "network" || !await connections.recoverMedia(route, signal)) throw error;
    return readPdf(score, signal, progress);
  }
}

async function readPdf(score: ScoreSummary, signal: AbortSignal, progress: (progress: ScorePdfProgress) => void) {
  const version = score.currentVersion;
  const base = `/api/choirs/${encodeURIComponent(score.choirId)}/scores/${encodeURIComponent(score.id)}`;
  const response = await diagnosticFetch(`${base}/versions/${encodeURIComponent(version.id)}/pdf`, { signal });
  if (!response.ok) throw Object.assign(new Error("offline_pdf_download_failed"), { status: response.status });
  progress({ loadedBytes: 0, totalBytes: version.sizeBytes });
  let data: ArrayBuffer;
  if (response.body) {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    try {
      while (true) {
        const part = await reader.read();
        signal.throwIfAborted();
        if (part.done) break;
        chunks.push(part.value); loaded += part.value.byteLength;
        if (loaded > version.sizeBytes) throw new Error("offline_pdf_size_mismatch");
        progress({ loadedBytes: loaded, totalBytes: version.sizeBytes });
      }
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
    const bytes = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    data = bytes.buffer;
  } else data = await response.arrayBuffer();
  if (data.byteLength !== version.sizeBytes || await sha256Hex(data) !== version.sha256) throw new Error("offline_pdf_checksum_mismatch");
  signal.throwIfAborted();
  return data;
}
