import { diagnosticFetch, parseDiagnosticResponse } from '../diagnostics/diagnostics';
import { SettingsRequestError } from '../settings/settings-request';

export const publishedPath = (drive: string) => `/api/choirs/${encodeURIComponent(drive)}/sight-singing/questions`;

export function isSightSingingMemberDenied(error: unknown) {
  return error instanceof SettingsRequestError && (error.status === 401 || error.status === 403);
}

export async function readSightSinging<T>(path: string, schema: { parse(value: unknown): T }, lifetime?: AbortSignal) {
  const deadline = AbortSignal.timeout(15_000);
  const signal = lifetime ? AbortSignal.any([lifetime, deadline]) : deadline;
  const response = await diagnosticFetch(path, { signal });
  signal.throwIfAborted();
  if (!response.ok) throw new SettingsRequestError(response.status);
  const data = await parseDiagnosticResponse(response, schema);
  signal.throwIfAborted();
  return data;
}
