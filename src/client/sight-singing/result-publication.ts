import {
  sightSingingResultResponseSchema, sightSingingResultsResponseSchema,
  type SightSingingResultSubmission,
} from '../../shared/sight-singing-results';
import { diagnosticFetch, parseDiagnosticResponse } from '../diagnostics/diagnostics';

const resultPath = (choirId: string, questionId: string) =>
  `/api/choirs/${encodeURIComponent(choirId)}/sight-singing/questions/${encodeURIComponent(questionId)}/results`;

export async function publishSightSingingResult(choirId: string, questionId: string, userId: string, result: SightSingingResultSubmission, signal?: AbortSignal) {
  const response = await diagnosticFetch(resultPath(choirId, questionId) + '?view=best', {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json', 'x-same-page-owner-user-id': userId },
    body: JSON.stringify(result),
  });
  if (!response.ok) throw new Error('publish_result_failed');
  return (await parseDiagnosticResponse(response, sightSingingResultResponseSchema)).published ?? true;
}

export async function readSightSingingResults(choirId: string, questionId: string, version: number | null, signal?: AbortSignal) {
  const query = new URLSearchParams({ view: 'best' });
  if (version !== null) query.set('version', String(version));
  const response = await diagnosticFetch(`${resultPath(choirId, questionId)}?${query}`, { signal });
  if (!response.ok) throw new Error('published_results_unavailable');
  return parseDiagnosticResponse(response, sightSingingResultsResponseSchema);
}

export async function withdrawSightSingingResult(choirId: string, questionId: string, userId: string, id: string, version: number) {
  const query = new URLSearchParams({ version: String(version) });
  const response = await diagnosticFetch(`${resultPath(choirId, questionId)}/${encodeURIComponent(id)}?${query}`, {
    method: 'DELETE', headers: { 'x-same-page-owner-user-id': userId },
  });
  if (!response.ok) throw new Error('withdraw_result_failed');
}
