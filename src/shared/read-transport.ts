import { type ConnectionRoute } from './connection';

export function readRoutes(preferred: ConnectionRoute, fallback: boolean): ConnectionRoute[] {
  return fallback ? [preferred, preferred === 'direct' ? 'backup' : 'direct'] : [preferred];
}
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
  } finally {
    clearTimeout(timer);
    if (aborted) signal.removeEventListener('abort', aborted);
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
  return async (path: string, verify: (response: Response) => Promise<boolean>, signal?: AbortSignal): Promise<Response> => {
    const url = new URL(path, options.origin);
    if (url.origin !== options.origin) throw new Error('invalid_public_asset_origin');
    const fixed = /^\/_releases\/[a-f0-9]{40}\/(?!\/)[^?#]+$/.test(url.pathname);
    const allowed = fixed && options.origins ? options.routes?.() ?? readRoutes(preferred, true) : [preferred];
    const routes = succeeded && allowed.includes(preferred) ? [preferred, ...allowed.filter(route => route !== preferred)] : allowed;
    for (const [index, route] of routes.entries()) {
      const endpoint = new URL(url);
      if (fixed && options.origins) endpoint.host = new URL(options.origins[route]).host;
      try {
        const response = await readAttempt(async attempt => {
          const response = await readAttempt(connect => {
            const init = { method: 'GET', credentials: 'omit', mode: 'cors', cache: 'no-store', redirect: 'error', signal: connect } as const;
            return send(new Request(endpoint, init));
          }, attempt, 4000);
          // HTTP errors are application responses, not evidence of a broken
          // network route. Never replace missing files with another version.
          if (response.status !== 200) throw new Error('public_asset_unavailable');
          if (!await verify(response)) throw new Error('public_asset_integrity');
          // Verification may consume a clone; retain a fully read body so late
          // network failures cannot escape outside this attempt's deadline.
          const bytes = await response.arrayBuffer();
          attempt.throwIfAborted();
          const headers = new Headers(response.headers);
          headers.delete('content-encoding'); headers.delete('content-length'); headers.delete('vary');
          return new Response(bytes, { status: 200, headers });
        }, signal, options.timeoutMs ?? 60_000);
        preferred = route; succeeded = true;
        return response;
      } catch (error) {
        signal?.throwIfAborted();
        if (!networkFailure(error) || index + 1 === routes.length) throw error;
      }
    }
    throw new Error('public_asset_unavailable');
  };
}
