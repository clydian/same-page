import { setTimeout as delay } from 'node:timers/promises';

const transientStatuses = new Set([429, 500, 502, 503, 504]);
const transientErrors = new Set(['TimeoutError', 'TypeError']);

// Opt in only for reads: a lost write response does not prove the write failed.
// Consume the body inside the attempt so a stalled/truncated download is retried too.
export async function releaseRequest(label, url, {
  init = {}, read, retryRead = false, timeoutMs = 15_000,
  fetchImpl = fetch, sleep = delay, warn = console.warn,
}) {
  const attempts = retryRead ? 3 : 1;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let failure, retryable = false;
    try {
      const response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (!transientStatuses.has(response.status)) return await read(response);
      failure = `HTTP ${response.status}`;
      retryable = true;
      await response.body?.cancel();
    } catch (error) {
      // Never include raw messages, URLs, response bodies or credentials in CI logs.
      failure = ['TimeoutError', 'TypeError', 'SyntaxError', 'AssertionError'].includes(error.name) ? error.name : 'request error';
      retryable = transientErrors.has(error.name);
    }
    if (!retryable || attempt === attempts) {
      throw new Error(`${label} failed after ${attempt} attempt${attempt === 1 ? '' : 's'} (${failure})`);
    }
    warn(`${label}: ${failure}; retrying read (${attempt + 1}/${attempts})`);
    await sleep(1_000 * attempt);
  }
}
