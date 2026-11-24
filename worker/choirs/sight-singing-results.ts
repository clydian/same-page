import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { legacySingingScoringRule, sightSingingResultSubmissionSchema, sightSingingScoringRuleSchema, type PublishedSightSingingResult } from '../../src/shared/sight-singing-results';
import { AuthorizationError } from '../auth/authorization';
import { resolveContextPrincipal } from '../auth/context-principal';
import type { AppEnvironment } from '../env';
import { readPermissionMember } from '../permissions/access';
import { limitDriveMutation } from '../security/drive-rate-limit';

const path = '/choirs/:choirId/sight-singing/questions/:questionId/results';
const activeActor = `EXISTS (SELECT 1 FROM membership_capabilities actor JOIN choirs drive ON drive.id = actor.choir_id
  WHERE actor.id = ? AND drive.purged_at IS NULL AND drive.is_preview_entry = 0)`;
const exactVersion = `EXISTS (SELECT 1 FROM sight_singing_question_versions
  WHERE choir_id = ? AND question_id = ? AND (? IS NULL OR version = ?))`;
const versionNumber = z.coerce.number().int().positive();
const uuid = z.uuid();

type ResultRow = Omit<PublishedSightSingingResult, 'own' | 'speed'> & { own: number; speed: PublishedSightSingingResult['speed'] | null };

async function hasQuestionVersion(db: D1Database, choirId: string, questionId: string, version: number | null, membershipId: string) {
  const row = await db.prepare(`SELECT ${activeActor} AS authorized, ${exactVersion} AS available`)
    .bind(membershipId, choirId, questionId, version, version).first<{ authorized: number; available: number }>();
  if (!row?.authorized) throw new AuthorizationError();
  return row.available === 1;
}

export const sightSingingResultRoutes = new Hono<AppEnvironment>();
sightSingingResultRoutes.use(path, async (context, next) => { context.header('Cache-Control', 'no-store'); await next(); });

sightSingingResultRoutes.get(path, async context => {
  const { choirId, questionId } = context.req.param();
  const db = context.env.DB;
  const member = await readPermissionMember(db, await resolveContextPrincipal(context), choirId);
  const id = uuid.safeParse(questionId);
  const bestView = context.req.query('view') === 'best';
  const version = (bestView ? versionNumber.optional() : versionNumber).safeParse(context.req.query('version'));
  const rule = sightSingingScoringRuleSchema.optional().safeParse(
    bestView && context.req.query('scoringRule') !== undefined ? Number(context.req.query('scoringRule')) : undefined);
  if (!id.success || !version.success || !rule.success) return context.json({ error: 'invalid_question_version' }, 400);
  const requested = version.data ?? null;
  if (!await hasQuestionVersion(db, choirId, id.data, requested, member.id)) return context.json({ error: 'question_version_not_found' }, 404);
  const scores = db.prepare(`WITH ranked AS (
    SELECT result.*, ROW_NUMBER() OVER (PARTITION BY membership_id ORDER BY score DESC, achieved_order) AS position
    FROM sight_singing_best_results result
    WHERE choir_id = ? AND question_id = ? AND scoring_rule = ? AND (? IS NULL OR version = ?)
  )
  SELECT result.id, result.question_id AS questionId, result.version, result.score, result.speed,
    result.voice_id AS voiceId, result.voice_name AS voiceName, singer.display_name AS displayName,
    result.membership_id = ? AS own
  FROM ranked result JOIN membership_capabilities singer
    ON singer.id = result.membership_id AND singer.choir_id = result.choir_id
  WHERE result.position = 1 AND ${activeActor}
  ORDER BY result.score DESC, result.achieved_order`).bind(choirId, id.data, rule.data ?? legacySingingScoringRule, requested, requested, member.id, member.id);
  const versions = db.prepare(`SELECT version FROM sight_singing_question_versions
    WHERE choir_id = ? AND question_id = ? AND ${activeActor} ORDER BY version DESC`).bind(choirId, id.data, member.id);
  const legacyScores = db.prepare(`SELECT 1 FROM sight_singing_best_results result JOIN membership_capabilities singer
    ON singer.id = result.membership_id AND singer.choir_id = result.choir_id
    WHERE result.choir_id = ? AND result.question_id = ? AND result.scoring_rule = ? AND ${activeActor} LIMIT 1`)
    .bind(choirId, id.data, legacySingingScoringRule, member.id);
  const [listing, editions, legacy] = await db.batch(rule.data === undefined ? [scores, versions] : [scores, versions, legacyScores]);
  const results = (listing.results as ResultRow[]).map(({ speed, own, ...row }) =>
    ({ ...row, own: own === 1, ...(bestView && speed !== null && { speed }) }));
  return context.json({ results, ...(bestView && { versions: (editions.results as { version: number }[]).map(row => row.version) }),
    ...(legacy && { hasLegacyScores: legacy.results.length > 0 }) });
});

sightSingingResultRoutes.post(path, bodyLimit({ maxSize: 4096 }), async context => {
  const { choirId, questionId } = context.req.param();
  const db = context.env.DB;
  const member = await readPermissionMember(db, await resolveContextPrincipal(context), choirId);
  if (context.req.header('x-same-page-owner-user-id') !== member.userId) throw new AuthorizationError();
  const id = uuid.safeParse(questionId);
  const submission = sightSingingResultSubmissionSchema.safeParse(await context.req.json().catch(() => null));
  if (!id.success || !submission.success) return context.json({ error: 'invalid_result' }, 400);
  const { id: resultId, version, score, voiceId, voiceName, speed, scoringRule = legacySingingScoringRule } = submission.data;
  if (!await hasQuestionVersion(db, choirId, id.data, version, member.id)) return context.json({ error: 'question_version_not_found' }, 404);
  const limited = await limitDriveMutation(context, member.userId, 'publish-sight-singing-result', 30);
  if (limited) return limited;

  // Preserve the fingerprints of previous client submissions.
  const receiptFields = [version, score, voiceId, voiceName, speed ?? null];
  if (scoringRule !== legacySingingScoringRule) receiptFields.push(scoringRule);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(receiptFields)));
  const fingerprint = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  const claim = crypto.randomUUID();
  // Only the request which inserts the receipt can change the best score.
  // Keep the receipt when the public entry is removed, so retries stay harmless.
  const receipt = db.prepare(`INSERT INTO sight_singing_result_receipts
      (choir_id, question_id, version, membership_id, id, fingerprint, claim)
    SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${activeActor} AND ${exactVersion}
      AND NOT EXISTS (SELECT 1 FROM sight_singing_results WHERE choir_id = ? AND question_id = ? AND id = ?)
    ON CONFLICT(choir_id, question_id, id) DO NOTHING`).bind(choirId, id.data, version, member.id, resultId, fingerprint,
    claim, member.id, choirId, id.data, version, version, choirId, id.data, resultId);
  const promote = db.prepare(`INSERT INTO sight_singing_best_results
      (choir_id, question_id, version, membership_id, scoring_rule, id, score, voice_id, voice_name, speed, achieved_order)
    SELECT choir_id, question_id, version, membership_id, ?, id, ?, ?, ?, ?, sequence
    FROM sight_singing_result_receipts WHERE choir_id = ? AND question_id = ? AND id = ? AND claim = ?
    ON CONFLICT(choir_id, question_id, scoring_rule, version, membership_id) DO UPDATE SET id = excluded.id, score = excluded.score,
      voice_id = excluded.voice_id, voice_name = excluded.voice_name, speed = excluded.speed, achieved_order = excluded.achieved_order
    WHERE excluded.score > sight_singing_best_results.score`).bind(scoringRule, score, voiceId, voiceName, speed ?? null, choirId, id.data, resultId, claim);
  const verify = db.prepare(`SELECT singer.display_name AS displayName, EXISTS (
      SELECT 1 FROM sight_singing_best_results WHERE choir_id = ? AND question_id = ? AND scoring_rule = ?
        AND version = ? AND membership_id = ? AND id = ?
    ) AS published
    FROM membership_capabilities singer WHERE singer.id = ? AND ${activeActor} AND (
      EXISTS (SELECT 1 FROM sight_singing_result_receipts
        WHERE choir_id = ? AND question_id = ? AND id = ? AND membership_id = ? AND fingerprint = ?) OR
      (? = 1 AND ? IS NULL AND EXISTS (SELECT 1 FROM sight_singing_results
        WHERE choir_id = ? AND question_id = ? AND id = ? AND version = ? AND membership_id = ? AND score = ? AND voice_id = ? AND voice_name = ?))
    )`).bind(choirId, id.data, scoringRule, version, member.id, resultId, member.id, member.id,
    choirId, id.data, resultId, member.id, fingerprint, scoringRule, speed ?? null,
    choirId, id.data, resultId, version, member.id, score, voiceId, voiceName);
  const [, , status] = await db.batch<{ displayName: string; published: number }>([receipt, promote, verify]);
  const row = status.results[0];
  if (row) {
    const bestView = context.req.query('view') === 'best';
    return context.json({ result: { id: resultId, version, score, voiceId, voiceName,
      ...(bestView && speed !== undefined && { speed }), questionId: id.data, displayName: row.displayName, own: true },
    ...(bestView && { published: row.published === 1 }) });
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
