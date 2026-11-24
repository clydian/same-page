import {
  sightSingingLeaderboardSchema, sightSingingResultResponseSchema, sightSingingResultsResponseSchema,
  type SightSingingResultSubmission, type SightSingingScoringRule, type SightSingingVersionFilter,
} from '../../shared/sight-singing-results';
import { diagnosticFetch, parseDiagnosticResponse } from '../diagnostics/diagnostics';

const resultPath = (choirId: string, questionId: string) =>
  `/api/choirs/${encodeURIComponent(choirId)}/sight-singing/questions/${encodeURIComponent(questionId)}/results`;

export async function publishSightSingingResult(choirId: string, questionId: string, userId: string,
  { perfect, writtenOctave, ...result }: SightSingingResultSubmission & { perfect: boolean; writtenOctave: boolean }, signal?: AbortSignal) {
  const query = new URLSearchParams({ view: 'best' });
  if (perfect) query.set('perfect', '1');
  if (perfect && writtenOctave) query.set('writtenOctave', '1');
  const response = await diagnosticFetch(`${resultPath(choirId, questionId)}?${query}`, {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json', 'x-same-page-owner-user-id': userId },
    body: JSON.stringify(result),
  });
  if (!response.ok) throw new Error('publish_result_failed');
  return (await parseDiagnosticResponse(response, sightSingingResultResponseSchema)).published ?? true;
}

export async function readSightSingingResults(choirId: string, questionId: string, version: number | null,
  scoringRule: SightSingingScoringRule, voice: string, signal?: AbortSignal) {
  const query = new URLSearchParams({ view: 'best', scoringRule: String(scoringRule), precision: '2', details: '1', writtenOctave: '1' });
  if (version !== null) query.set('version', String(version));
  if (voice) query.set('voice', voice);
  const response = await diagnosticFetch(`${resultPath(choirId, questionId)}?${query}`, { signal });
  if (!response.ok) throw new Error('published_results_unavailable');
  return parseDiagnosticResponse(response, sightSingingResultsResponseSchema);
}

export async function readSightSingingLeaderboard(choirId: string, versions: SightSingingVersionFilter, voice: string, signal?: AbortSignal) {
  const query = new URLSearchParams({ versions, precision: '2', details: '1', writtenOctave: '1', podium: '1' });
  if (voice) query.set('voice', voice);
  const response = await diagnosticFetch(`/api/choirs/${encodeURIComponent(choirId)}/sight-singing/leaderboard?${query}`, { signal });
  if (!response.ok) throw new Error('published_results_unavailable');
  return parseDiagnosticResponse(response, sightSingingLeaderboardSchema);
}

export async function withdrawSightSingingResult(choirId: string, questionId: string, userId: string, id: string, version: number) {
  const query = new URLSearchParams({ version: String(version) });
  const response = await diagnosticFetch(`${resultPath(choirId, questionId)}/${encodeURIComponent(id)}?${query}`, {
    method: 'DELETE', headers: { 'x-same-page-owner-user-id': userId },
  });
  if (!response.ok) throw new Error('withdraw_result_failed');
}
