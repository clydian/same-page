import { setTimeout as delay } from 'node:timers/promises';
import { buffer } from 'node:stream/consumers';

const transientStatuses = new Set([429, 500, 502, 503, 504]);
const transientErrors = new Set(['TimeoutError', 'TypeError']);
const transientCodes = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN']);

// Opt in only for reads: a lost write response does not prove the write failed.
export async function releaseOperation(label, operation, {
  retryRead = false, timeoutMs = 15_000, sleep = delay, warn = console.warn,
} = {}) {
  const attempts = retryRead ? 3 : 1;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    let timer, failure, retryable;
    try {
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new DOMException('Release request deadline exceeded', 'TimeoutError');
          controller.abort(error);
          reject(error);
        }, timeoutMs);
      });
      return await Promise.race([operation(controller.signal), timeout]);
    } catch (error) {
      const status = error.$metadata?.httpStatusCode;
      // Never include raw messages, URLs, response bodies or credentials in CI logs.
      failure = Number.isInteger(status) ? `HTTP ${status}` :
        ['TimeoutError', 'TypeError', 'SyntaxError', 'AssertionError'].includes(error.name) ? error.name : 'request error';
      retryable = transientStatuses.has(status) || transientErrors.has(error.name) || transientCodes.has(error.code);
    } finally {
      clearTimeout(timer);
    }
    if (!retryable || attempt === attempts) {
      throw new Error(`${label} failed after ${attempt} attempt${attempt === 1 ? '' : 's'} (${failure})`);
    }
    warn(`${label}: ${failure}; retrying read (${attempt + 1}/${attempts})`);
    await sleep(1_000 * attempt);
  }
}

// Consume the body inside the attempt so a stalled/truncated download is retried too.
export function releaseRequest(label, url, { init = {}, read, fetchImpl = fetch, ...options }) {
  return releaseOperation(label, async signal => {
    const response = await fetchImpl(url, { ...init, signal });
    if (transientStatuses.has(response.status)) {
      await response.body?.cancel();
      const error = new Error('Transient release response');
      error.$metadata = { httpStatusCode: response.status };
      throw error;
    }
    return read(response);
  }, options);
}

// The SDK may finish its request retry at headers. Keep the deadline through the
// Node response stream, destroy stalled bodies, and retry the complete GET only.
export function readReleaseObject(key, getObject, options) {
  return releaseOperation(`R2 release object ${key}`, async signal => {
    let object;
    try { object = await getObject(signal); }
    catch (error) { if (error.$metadata?.httpStatusCode === 404) return null; throw error; }
    const abort = () => object.Body.destroy(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    try {
      if (signal.aborted) { abort(); throw signal.reason; }
      const bytes = await buffer(object.Body);
      return { arrayBuffer: async () => bytes };
    } finally { signal.removeEventListener('abort', abort); }
  }, { ...options, retryRead: true });
}
