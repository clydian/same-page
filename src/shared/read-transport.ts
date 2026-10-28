import { type ConnectionRoute } from './connection';

export function readRoutes(preferred: ConnectionRoute, fallback: boolean): ConnectionRoute[] {
  return fallback ? [preferred, preferred === 'direct' ? 'backup' : 'direct'] : [preferred];
}
// A bounded recovery hint, not proof that the shared backend is healthy.
export function gatewayFailure(status: number) { return status === 502 || status === 504; }
class GatewayReadError extends Error { constructor() { super('public_asset_unavailable'); } }

export function networkFailure(error: unknown) {
  return error instanceof TypeError || error instanceof DOMException && error.name === 'TimeoutError';
}
// The caller owns the total task budget. Each attempt owns its shorter deadline
// and removes its timer/listener on success, cancellation or failure.
export async function readAttempt<T>(operation: (signal: AbortSignal) => Promise<T>, caller: AbortSignal | undefined, timeoutMs: number): Promise<T> {
  caller?.throwIfAborted();
  const controller = new AbortController();
  const signal = caller ? AbortSignal.any([caller, controller.signal]) : controller.signal;
  const timer = setTimeout(() => controller.abort(new DOMException('Read timeout', 'TimeoutError')), timeoutMs);
  let aborted: (() => void) | undefined;
  try {
    return await Promise.race([
      operation(signal),
      new Promise<never>((_resolve, reject) => {
        aborted = () => reject(signal.reason);
        signal.addEventListener('abort', aborted, { once: true });
        if (signal.aborted) aborted();
      }),
    ]);
  } catch (error) {
    controller.abort(error);
    throw error;
  } finally {
    clearTimeout(timer);
    if (aborted) signal.removeEventListener('abort', aborted);
  }
}

// These deadlines apply to a complete attempt; connection setup is a shorter cap.
const manifestBudgetMs = 15_000, manifestFirstAttemptMs = 6_000, bodyIdleMs = 10_000;
export type PublicReadPolicy = 'asset' | 'manifest';

// Read the body with a progress deadline, releasing the old stream on every exit.
// A failed attempt is discarded; bytes from different routes are never joined.
async function readBody(response: Response, signal: AbortSignal) {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0, idleDeadline = Date.now() + bodyIdleMs, complete = false;
  try {
    while (true) {
      const remaining = idleDeadline - Date.now();
      if (remaining <= 0) throw new DOMException('Read stalled', 'TimeoutError');
      const { done, value } = await readAttempt(() => reader.read(), signal, remaining);
      if (done) { complete = true; break; }
      if (value.byteLength) {
        chunks.push(value); size += value.byteLength;
        idleDeadline = Date.now() + bodyIdleMs;
      }
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  } finally {
    // Cancellation can itself stall. Do not extend the read budget while waiting
    // for it, or let its rejection become an unhandled promise.
    if (!complete) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export interface PublicAssetOptions {
  origin: string;
  origins?: Record<ConnectionRoute, string>;
  send?: typeof fetch;
  timeoutMs?: number;
  routes?: () => ConnectionRoute[];
}
// Only sealed release paths may cross origins. This interface reads the whole
// response and verifies it before returning; a broken body can therefore fail
// over just like a connection failure. No cookies or business requests cross it.
export function publicAssetReader(options: PublicAssetOptions) {
  const send: typeof fetch = (...args) => (options.send ?? globalThis.fetch)(...args);
  let preferred: ConnectionRoute = options.origin === options.origins?.backup ? 'backup' : 'direct';
  let succeeded = false;
  return async (path: string, verify: (response: Response) => Promise<boolean>, signal?: AbortSignal, policy: PublicReadPolicy = 'asset'): Promise<Response> => {
    const url = new URL(path, options.origin);
    if (url.origin !== options.origin) throw new Error('invalid_public_asset_origin');
    const fixed = /^\/_releases\/[a-f0-9]{40}\/(?!\/)[^?#]+$/.test(url.pathname);
    const allowed = fixed && options.origins ? options.routes?.() ?? readRoutes(preferred, true) : [preferred];
    const routes = succeeded && allowed.includes(preferred) ? [preferred, ...allowed.filter(route => route !== preferred)] : allowed;
    const attemptLimit = options.timeoutMs ?? 60_000;
    const totalMs = policy === 'manifest' ? manifestBudgetMs : attemptLimit * routes.length;
    const deadline = Date.now() + totalMs;
    return readAttempt(async total => {
      for (const [index, route] of routes.entries()) {
        total.throwIfAborted();
        const endpoint = new URL(url);
        if (fixed && options.origins) endpoint.host = new URL(options.origins[route]).host;
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new DOMException('Read deadline', 'TimeoutError');
        const attemptMs = policy === 'manifest'
          ? Math.min(remaining, index === 0 && routes.length > 1 ? manifestFirstAttemptMs : remaining)
          : Math.min(remaining, attemptLimit);
        try {
          const response = await readAttempt(async attempt => {
            const response = await readAttempt(connect => {
              const init = { method: 'GET', credentials: 'omit', mode: 'cors', cache: 'no-store', redirect: 'error', signal: connect } as const;
              return send(new Request(endpoint, init));
            }, attempt, Math.min(4000, attemptMs));
            if (response.status !== 200) {
              void response.body?.cancel().catch(() => {});
              if (fixed && gatewayFailure(response.status)) throw new GatewayReadError();
              throw new Error('public_asset_unavailable');
            }
            // Validation errors remain content errors, including validator TypeErrors.
            const bytes = await readBody(response, attempt);
            attempt.throwIfAborted();
            const headers = new Headers(response.headers);
            headers.delete('content-encoding'); headers.delete('content-length'); headers.delete('vary');
            try {
              if (!await verify(new Response(bytes, { status: 200, headers }))) throw new Error('invalid_asset');
            } catch (cause) { throw new Error('public_asset_integrity', { cause }); }
            attempt.throwIfAborted();
            return new Response(bytes, { status: 200, headers });
          }, total, attemptMs);
          preferred = route; succeeded = true;
          return response;
        } catch (error) {
          total.throwIfAborted();
          if (!(networkFailure(error) || error instanceof GatewayReadError) || index + 1 === routes.length) throw error;
        }
      }
      throw new Error('public_asset_unavailable');
    }, signal, totalMs);
  };
}
