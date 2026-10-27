import { diagnosticRequest } from "../diagnostics/diagnostics";
import { connections, connectionsEnabled, connectionUrl } from "../connection/connection";
import { EntryIdentityConflictError } from "../connection/controller";

export const UPLOAD_TIMEOUT_MS = 10 * 60_000;

export interface UploadProgress {
  percent: number | null;
  bytesPerSecond: number;
  processing: boolean;
}

export function uploadPdf(url: string, form: FormData, signal: AbortSignal, onProgress: (progress: UploadProgress) => void) {
  return uploadBody(url, form, signal, onProgress);
}

export function uploadBody(url: string, body: FormData | Blob, signal: AbortSignal, onProgress: (progress: UploadProgress) => void, method = "POST") {
  const send = (endpoint: string) => diagnosticRequest(url, { method, signal }, () => new Promise<Response>((resolve, reject) => {
    const route = connections.getSnapshot().active;
    const xhr = new XMLHttpRequest();
    const started = performance.now();
    const abort = () => xhr.abort();
    const cleanup = () => {
      signal.removeEventListener("abort", abort);
      xhr.upload.onprogress = null;
      xhr.upload.onload = null;
    };
    if (signal.aborted) { reject(new DOMException("Aborted", "AbortError")); return; }
    xhr.upload.onprogress = (event) => onProgress({
      percent: event.lengthComputable && event.total > 0 ? Math.min(100, event.loaded / event.total * 100) : null,
      bytesPerSecond: event.loaded / Math.max((performance.now() - started) / 1000, 0.001),
      processing: false,
    });
    xhr.upload.onload = () => onProgress({ percent: 100, bytesPerSecond: 0, processing: true });
    xhr.onload = () => {
      cleanup();
      const headers = new Headers();
      for (const line of xhr.getAllResponseHeaders().trim().split(/[\r\n]+/)) {
        const index = line.indexOf(":");
        if (index > 0) headers.append(line.slice(0, index), line.slice(index + 1).trim());
      }
      if (xhr.status === 0) { reject(new TypeError("Upload failed")); return; }
      if (headers.get("X-Same-Page-Entry-Conflict") === "1") { connections.reportIdentityConflict(route); reject(new EntryIdentityConflictError()); return; }
      resolve(new Response([204, 205, 304].includes(xhr.status) ? null : xhr.responseText, { status: xhr.status, headers }));
    };
    xhr.onerror = () => { cleanup(); if (connectionsEnabled) connections.reportFailure(route); reject(new TypeError("Upload failed")); };
    xhr.onabort = () => { cleanup(); reject(new DOMException("Aborted", "AbortError")); };
    signal.addEventListener("abort", abort, { once: true });
    try { xhr.open(method, endpoint); xhr.withCredentials = true; xhr.timeout = UPLOAD_TIMEOUT_MS; xhr.ontimeout = () => { cleanup(); if (connectionsEnabled) connections.reportFailure(route); reject(new TypeError("Upload timed out")); }; xhr.send(body); } catch (error) { cleanup(); reject(error); }
  }));
  return connectionsEnabled ? connections.writeEndpoint(url, signal).then(send) : send(connectionUrl(url));
}
