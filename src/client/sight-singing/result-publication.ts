import {
  sightSingingLeaderboardSchema, sightSingingResultResponseSchema, sightSingingResultsResponseSchema,
  type SightSingingResultSubmission,
} from '../../shared/sight-singing-results';
import { diagnosticFetch, parseDiagnosticResponse } from '../diagnostics/diagnostics';
import { readSightSinging } from './read';

const resultPath = (choirId: string, questionId: string) =>
  `/api/choirs/${encodeURIComponent(choirId)}/sight-singing/questions/${encodeURIComponent(questionId)}/results`;

export async function publishSightSingingResult(choirId: string, questionId: string, userId: string,
  result: SightSingingResultSubmission, signal?: AbortSignal) {
  const response = await diagnosticFetch(resultPath(choirId, questionId), {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json', 'x-same-page-owner-user-id': userId },
    body: JSON.stringify(result),
  });
  if (!response.ok) throw new Error('publish_result_failed');
  const { published, standing } = await parseDiagnosticResponse(response, sightSingingResultResponseSchema);
  return { published, standing };
}

export type SightSingingResultFilters = { version?: number; voice?: string; speed?: SightSingingResultSubmission['speed'] };

export async function readSightSingingResults(choirId: string, questionId: string,
  { version, voice, speed }: SightSingingResultFilters, signal?: AbortSignal) {
  const query = new URLSearchParams();
  if (version !== undefined) query.set('version', String(version));
  if (voice) query.set('voice', voice);
  if (speed !== undefined) query.set('speed', String(speed));
  return readSightSinging(resultPath(choirId, questionId) + (query.size ? `?${query}` : ''), sightSingingResultsResponseSchema, signal);
}

export async function readSightSingingLeaderboard(choirId: string, signal?: AbortSignal) {
  return readSightSinging(`/api/choirs/${encodeURIComponent(choirId)}/sight-singing/leaderboard`, sightSingingLeaderboardSchema, signal);
}

export async function withdrawSightSingingResult(choirId: string, questionId: string, userId: string, id: string, version: number) {
  const query = new URLSearchParams({ version: String(version) });
  const response = await diagnosticFetch(`${resultPath(choirId, questionId)}/${encodeURIComponent(id)}?${query}`, {
    method: 'DELETE', headers: { 'x-same-page-owner-user-id': userId },
  });
  if (!response.ok) throw new Error('withdraw_result_failed');
}
