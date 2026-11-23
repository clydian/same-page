import {
  sightSingingResultResponseSchema, sightSingingResultsResponseSchema,
  type SightSingingResultSubmission,
} from '../../shared/sight-singing-results';
import { diagnosticFetch, parseDiagnosticResponse } from '../diagnostics/diagnostics';

const resultPath = (choirId: string, questionId: string) =>
  `/api/choirs/${encodeURIComponent(choirId)}/sight-singing/questions/${encodeURIComponent(questionId)}/results`;

export async function publishSightSingingResult(choirId: string, questionId: string, userId: string, result: SightSingingResultSubmission, signal?: AbortSignal) {
  const response = await diagnosticFetch(resultPath(choirId, questionId), {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json', 'x-same-page-owner-user-id': userId },
    body: JSON.stringify(result),
  });
  if (!response.ok) throw new Error('publish_result_failed');
  return (await parseDiagnosticResponse(response, sightSingingResultResponseSchema)).result;
}

export async function readSightSingingResults(choirId: string, questionId: string, version: number, signal?: AbortSignal) {
  const response = await diagnosticFetch(`${resultPath(choirId, questionId)}?${new URLSearchParams({ version: String(version) })}`, { signal });
  if (!response.ok) throw new Error('published_results_unavailable');
  return (await parseDiagnosticResponse(response, sightSingingResultsResponseSchema)).results;
}
