import { guestSessionResponseSchema } from '../../shared/choirs';
import { untilAborted } from '../platform/abortable';

export const guestEntryBudgetMs = 9000;
const maxResponseBytes = 64 * 1024;

// This one stateless admission endpoint can be repeated safely. Do not expose
// a successful Response until its small JSON body is complete and valid: a
// 200 header alone neither admits the caller nor finishes the waiting state.
export async function completeGuestAdmission(response: Response, signal: AbortSignal) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('invalid_guest_admission_response');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await untilAborted(reader.read(), signal);
      if (done) break;
      size += value.byteLength;
      if (size > maxResponseBytes) throw new Error('guest_admission_response_too_large');
      chunks.push(value);
    }
    signal.throwIfAborted();
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    throw error;
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    guestSessionResponseSchema.parse(JSON.parse(text));
  } catch { throw new Error('invalid_guest_admission_response'); }
  const headers = new Headers(response.headers);
  headers.delete('content-length'); headers.delete('content-encoding');
  return new Response(text, { status: response.status, statusText: response.statusText, headers });
}
