import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import {
  sightSingingResultSubmissionSchema, sightSingingSpeedSchema, sightSingingVoiceNameSchema, type PublishedSightSingingResult, type SightSingingLeaderboard,
  type SightSingingExtraBadge, type SightSingingStandingNeighbor,
} from '../../src/shared/sight-singing-results';
import { AuthorizationError } from '../auth/authorization';
import { resolveContextPrincipal } from '../auth/context-principal';
import type { AppEnvironment } from '../env';
import { readPermissionMember } from '../permissions/access';
import { limitDriveMutation } from '../security/drive-rate-limit';

const path = '/choirs/:choirId/sight-singing/questions/:questionId/results';
const leaderboardPath = '/choirs/:choirId/sight-singing/leaderboard';
const activeActor = `EXISTS (SELECT 1 FROM membership_capabilities actor JOIN choirs drive ON drive.id = actor.choir_id
  WHERE actor.id = ? AND drive.purged_at IS NULL AND drive.is_preview_entry = 0)`;
const exactVersion = `EXISTS (SELECT 1 FROM sight_singing_question_versions edition
  JOIN sight_singing_questions question ON question.choir_id = edition.choir_id AND question.id = edition.question_id
  WHERE edition.choir_id = ? AND edition.question_id = ? AND (? IS NULL OR edition.version = ?))`;
const versionNumber = z.coerce.number().int().positive();
const uuid = z.uuid();

type BadgeFields = { perfect: number; writtenOctave: number; badge: SightSingingExtraBadge | null };
type ResultRow = Omit<PublishedSightSingingResult, 'own' | 'perfect' | 'writtenOctave' | 'badge'> & BadgeFields & { own: number };
type LeaderboardRow = Omit<SightSingingLeaderboard['results'][number], 'perfect' | 'writtenOctave' | 'badge'> & BadgeFields;
type StandingRow = { place: number; tied: number; participants: number; previousPlace: number; previousHundredths: number | null; nearby: string };

function resultBadges(perfect: number | boolean, writtenOctave: number | boolean, badge?: SightSingingExtraBadge | null) {
  return { ...(perfect && { perfect: true }), ...(writtenOctave && { writtenOctave: true }), ...(badge && { badge }) };
}

async function hasQuestionVersion(db: D1Database, choirId: string, questionId: string, version: number | null, membershipId: string) {
  const row = await db.prepare(`SELECT ${activeActor} AS authorized, ${exactVersion} AS available`)
    .bind(membershipId, choirId, questionId, version, version).first<{ authorized: number; available: number }>();
  if (!row?.authorized) throw new AuthorizationError();
  return row.available === 1;
}

export const sightSingingResultRoutes = new Hono<AppEnvironment>();
sightSingingResultRoutes.use(path, async (context, next) => { context.header('Cache-Control', 'no-store'); await next(); });

sightSingingResultRoutes.get(leaderboardPath, async context => {
  const { choirId } = context.req.param();
  const db = context.env.DB;
  const member = await readPermissionMember(db, await resolveContextPrincipal(context), choirId);
  if (!await db.prepare(`SELECT 1 WHERE ${activeActor}`).bind(member.id).first()) throw new AuthorizationError();
  context.header('Cache-Control', 'no-store');
  const scope = `FROM sight_singing_best_results result
    JOIN membership_capabilities singer ON singer.choir_id = result.choir_id AND singer.id = result.membership_id
    WHERE result.choir_id = ? AND ${activeActor}`;
  const top = db.prepare(`WITH per_singer AS (
      SELECT result.id, result.question_id AS questionId, result.version, result.score_hundredths, result.voice_name AS voiceName,
        result.speed, result.perfect, result.written_octave AS writtenOctave, result.badge, singer.display_name AS displayName, result.achieved_order,
        ROW_NUMBER() OVER (PARTITION BY result.question_id, result.membership_id ORDER BY result.score_hundredths DESC, result.achieved_order) AS best
      ${scope}
    ), top_three AS (
      SELECT *, RANK() OVER (PARTITION BY questionId ORDER BY score_hundredths DESC) AS place
      FROM per_singer WHERE best = 1
    )
    SELECT id, questionId, version, score_hundredths / 100.0 AS score, voiceName, displayName, speed, perfect, writtenOctave, badge
    FROM top_three WHERE place <= 3 ORDER BY questionId, place, achieved_order`).bind(choirId, member.id);
  const participants = db.prepare(`SELECT result.question_id AS questionId, COUNT(DISTINCT result.membership_id) AS count
    ${scope} GROUP BY result.question_id`).bind(choirId, member.id);
  const [results, counts] = await db.batch([top, participants]);
  const rows = (results.results as LeaderboardRow[]).map(({ perfect, writtenOctave, badge, ...row }) =>
    ({ ...row, ...resultBadges(perfect, writtenOctave, context.req.query('badges') === '1' ? badge : undefined) }));
  return context.json({ results: rows, participants: counts.results });
});

sightSingingResultRoutes.get(path, async context => {
  const { choirId, questionId } = context.req.param();
  const db = context.env.DB;
  const member = await readPermissionMember(db, await resolveContextPrincipal(context), choirId);
  const id = uuid.safeParse(questionId);
  const version = versionNumber.optional().safeParse(context.req.query('version'));
  const voice = sightSingingVoiceNameSchema.optional().safeParse(context.req.query('voice'));
  if (!id.success || !version.success || !voice.success) return context.json({ error: 'invalid_question_version' }, 400);
  const speed = z.coerce.number().pipe(sightSingingSpeedSchema).optional().safeParse(context.req.query('speed'));
  if (!speed.success) return context.json({ error: 'invalid_speed' }, 400);
  const requested = version.data ?? null;
  if (!await hasQuestionVersion(db, choirId, id.data, requested, member.id)) return context.json({ error: 'question_version_not_found' }, 404);
  const scores = db.prepare(`WITH ranked AS (
    SELECT result.*,
      ROW_NUMBER() OVER (PARTITION BY membership_id ORDER BY result.score_hundredths DESC, achieved_order) AS position
    FROM sight_singing_best_results result
    WHERE choir_id = ? AND question_id = ? AND (? IS NULL OR version = ?)
      AND (? IS NULL OR voice_name = ?) AND (? IS NULL OR speed = ?)
  )
  SELECT result.id, result.question_id AS questionId, result.version, result.score_hundredths / 100.0 AS score, result.speed,
    result.perfect, result.written_octave AS writtenOctave, result.badge,
    result.voice_id AS voiceId, result.voice_name AS voiceName, singer.display_name AS displayName,
    result.membership_id = ? AS own
  FROM ranked result JOIN membership_capabilities singer
    ON singer.id = result.membership_id AND singer.choir_id = result.choir_id
  WHERE result.position = 1 AND ${activeActor}
  ORDER BY result.score_hundredths DESC, result.achieved_order`)
    .bind(choirId, id.data, requested, requested, voice.data ?? null, voice.data ?? null,
      speed.data ?? null, speed.data ?? null, member.id, member.id);
  const facets = db.prepare(`SELECT DISTINCT result.voice_name AS voice
    FROM sight_singing_best_results result JOIN membership_capabilities singer
    ON singer.id = result.membership_id AND singer.choir_id = result.choir_id
    WHERE result.choir_id = ? AND result.question_id = ? AND ${activeActor} ORDER BY voice`)
    .bind(choirId, id.data, member.id);
  const [listing, metadata] = await db.batch([scores, facets]);
  const results = (listing.results as ResultRow[]).map(({ own, perfect, writtenOctave, badge, ...row }) =>
    ({ ...row, own: own === 1, ...resultBadges(perfect, writtenOctave, context.req.query('badges') === '1' ? badge : undefined) }));
  return context.json({ results, voices: (metadata.results as { voice: string }[]).map(row => row.voice) });
});

sightSingingResultRoutes.post(path, bodyLimit({ maxSize: 4096 }), async context => {
  const { choirId, questionId } = context.req.param();
  const db = context.env.DB;
  const member = await readPermissionMember(db, await resolveContextPrincipal(context), choirId);
  if (context.req.header('x-same-page-owner-user-id') !== member.userId) throw new AuthorizationError();
  const id = uuid.safeParse(questionId);
  const submission = sightSingingResultSubmissionSchema.safeParse(await context.req.json().catch(() => null));
  if (!id.success || !submission.success) return context.json({ error: 'invalid_result' }, 400);
  const { id: resultId, version, score, voiceId, voiceName, speed, perfect, writtenOctave, badge } = submission.data;
  if (!await hasQuestionVersion(db, choirId, id.data, version, member.id)) return context.json({ error: 'question_version_not_found' }, 404);
  const limited = await limitDriveMutation(context, member.userId, 'publish-sight-singing-result', 30);
  if (limited) return limited;

  const receiptFields = [version, score, voiceId, voiceName, speed, perfect, writtenOctave, ...(badge === undefined ? [] : [badge])];
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(receiptFields)));
  const fingerprint = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  const claim = crypto.randomUUID();
  const hundredths = Math.round(score * 100);
  // Only the request which inserts the receipt can change the best score.
  // Keep the receipt when the public entry is removed, so retries stay harmless.
  const receipt = db.prepare(`INSERT INTO sight_singing_result_receipts
      (choir_id, question_id, version, membership_id, id, fingerprint, claim)
    SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${activeActor} AND ${exactVersion}
    ON CONFLICT(choir_id, question_id, id) DO NOTHING`).bind(choirId, id.data, version, member.id, resultId, fingerprint,
    claim, member.id, choirId, id.data, version, version);
  const promote = db.prepare(`INSERT INTO sight_singing_best_results
      (choir_id, question_id, version, membership_id, id, score_hundredths, voice_id, voice_name, speed, perfect, written_octave, badge, achieved_order)
    SELECT choir_id, question_id, version, membership_id, id, ?, ?, ?, ?, ?, ?, ?, sequence
    FROM sight_singing_result_receipts WHERE choir_id = ? AND question_id = ? AND id = ? AND claim = ?
    ON CONFLICT(choir_id, question_id, version, membership_id, voice_id, speed) DO UPDATE SET id = excluded.id,
      score_hundredths = excluded.score_hundredths, voice_name = excluded.voice_name,
      perfect = excluded.perfect, written_octave = excluded.written_octave, badge = excluded.badge, achieved_order = excluded.achieved_order
    WHERE excluded.score_hundredths > sight_singing_best_results.score_hundredths`)
    .bind(hundredths, voiceId, voiceName, speed, Number(perfect), Number(writtenOctave), badge ?? null, choirId, id.data, resultId, claim);
  const verify = db.prepare(`SELECT singer.display_name AS displayName, EXISTS (
      SELECT 1 FROM sight_singing_best_results WHERE choir_id = ? AND question_id = ?
        AND version = ? AND membership_id = ? AND id = ?
    ) AS published
    FROM membership_capabilities singer WHERE singer.id = ? AND ${activeActor}
      AND EXISTS (SELECT 1 FROM sight_singing_result_receipts
        WHERE choir_id = ? AND question_id = ? AND id = ? AND membership_id = ? AND fingerprint = ?)`)
    .bind(choirId, id.data, version, member.id, resultId, member.id, member.id,
      choirId, id.data, resultId, member.id, fingerprint);
  // Use the same best-per-member scope as the question card, before promoting this take.
  const rank = db.prepare(`WITH personal_bests AS (
      SELECT result.id, result.membership_id, singer.display_name, result.achieved_order, result.score_hundredths AS hundredths,
        ROW_NUMBER() OVER (PARTITION BY result.membership_id ORDER BY result.score_hundredths DESC, result.achieved_order) AS best
      FROM sight_singing_best_results result
      JOIN membership_capabilities singer ON singer.id = result.membership_id AND singer.choir_id = result.choir_id
      WHERE result.choir_id = ? AND result.question_id = ?
    ), previous AS (
      SELECT hundredths FROM personal_bests WHERE membership_id = ? AND best = 1
    ), others AS (
      SELECT id, display_name, hundredths,
        ROW_NUMBER() OVER (ORDER BY hundredths DESC, achieved_order) AS position,
        RANK() OVER (ORDER BY hundredths DESC) AS place,
        COUNT(*) OVER (PARTITION BY hundredths) > 1 AS tied
      FROM personal_bests WHERE membership_id <> ? AND best = 1
    ), standing AS (
      SELECT 1 + COUNT(CASE WHEN hundredths > ? THEN 1 END) AS place,
        EXISTS (SELECT 1 FROM others WHERE hundredths = ?) AS tied,
        1 + COUNT(*) AS participants,
        1 + COUNT(CASE WHEN hundredths > (SELECT hundredths FROM previous) THEN 1 END) AS previousPlace,
        (SELECT hundredths FROM previous) AS previousHundredths FROM others
    )
    SELECT standing.*, (SELECT json_group_array(json_object('id', id, 'displayName', display_name,
      'score', hundredths / 100.0, 'position', position, 'place', place, 'tied', tied)) FROM (
        SELECT * FROM others
        WHERE position BETWEEN standing.place - 2 AND standing.place + 1
          OR (standing.previousPlace > standing.place AND position BETWEEN standing.previousPlace - 2 AND standing.previousPlace + 1)
        ORDER BY position
      )) AS nearby FROM standing`)
    .bind(choirId, id.data, member.id, member.id, hundredths, hundredths);
  const [before, , , status] = await db.batch([rank, receipt, promote, verify]);
  const row = status.results[0] as { displayName: string; published: number } | undefined;
  if (row) {
    const rankRow = before.results[0] as StandingRow;
    const standing = {
      place: rankRow.place, tied: rankRow.tied === 1, participants: rankRow.participants,
      ...(rankRow.previousHundredths !== null && { previous: { place: rankRow.previousPlace, score: rankRow.previousHundredths / 100 } }),
      nearby: (JSON.parse(rankRow.nearby) as (Omit<SightSingingStandingNeighbor, 'tied'> & { tied: number })[])
        .map(row => ({ ...row, tied: row.tied === 1 })),
    };
    return context.json({ result: { id: resultId, version, score, voiceId, voiceName,
      speed, questionId: id.data, displayName: row.displayName, own: true, ...resultBadges(perfect, writtenOctave, badge) },
      published: row.published === 1, standing });
  }
  if (!await hasQuestionVersion(db, choirId, id.data, version, member.id)) return context.json({ error: 'question_version_not_found' }, 404);
  return context.json({ error: 'result_conflict' }, 409);
});

sightSingingResultRoutes.delete(`${path}/:resultId`, async context => {
  const { choirId, questionId, resultId } = context.req.param();
  const db = context.env.DB;
  const member = await readPermissionMember(db, await resolveContextPrincipal(context), choirId);
  if (context.req.header('x-same-page-owner-user-id') !== member.userId) throw new AuthorizationError();
  const version = versionNumber.safeParse(context.req.query('version'));
  if (!uuid.safeParse(questionId).success || !uuid.safeParse(resultId).success || !version.success) {
    return context.json({ error: 'invalid_result' }, 400);
  }
  await db.prepare(`DELETE FROM sight_singing_best_results
    WHERE choir_id = ? AND question_id = ? AND version = ? AND id = ? AND membership_id = ? AND ${activeActor}`)
    .bind(choirId, questionId, version.data, resultId, member.id, member.id).run();
  return context.body(null, 204, { 'Cache-Control': 'no-store' });
});
