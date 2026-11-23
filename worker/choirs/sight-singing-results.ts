import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { sightSingingResultSubmissionSchema, type PublishedSightSingingResult } from '../../src/shared/sight-singing-results';
import { AuthorizationError } from '../auth/authorization';
import { resolveContextPrincipal } from '../auth/context-principal';
import type { AppEnvironment } from '../env';
import { readPermissionMember } from '../permissions/access';
import { limitDriveMutation } from '../security/drive-rate-limit';

const path = '/choirs/:choirId/sight-singing/questions/:questionId/results';
const activeActor = `EXISTS (SELECT 1 FROM membership_capabilities actor JOIN choirs drive ON drive.id = actor.choir_id
  WHERE actor.id = ? AND drive.purged_at IS NULL AND drive.is_preview_entry = 0)`;
const exactVersion = `EXISTS (SELECT 1 FROM sight_singing_question_versions
  WHERE choir_id = ? AND question_id = ? AND version = ?)`;
const resultColumns = `result.id, result.question_id AS questionId, result.version, result.score,
  result.voice_id AS voiceId, result.voice_name AS voiceName, singer.display_name AS displayName,
  result.membership_id = ? AS own`;
const resultRows = `FROM sight_singing_results result JOIN membership_capabilities singer
  ON singer.id = result.membership_id AND singer.choir_id = result.choir_id`;

type ResultRow = Omit<PublishedSightSingingResult, 'own'> & { own: number };
const serialize = (row: ResultRow): PublishedSightSingingResult => ({ ...row, own: row.own === 1 });

async function hasQuestionVersion(db: D1Database, choirId: string, questionId: string, version: number, membershipId: string) {
  const row = await db.prepare(`SELECT ${activeActor} AS authorized, ${exactVersion} AS available`)
    .bind(membershipId, choirId, questionId, version).first<{ authorized: number; available: number }>();
  if (!row?.authorized) throw new AuthorizationError();
  return row.available === 1;
}

export const sightSingingResultRoutes = new Hono<AppEnvironment>();
sightSingingResultRoutes.use(path, async (context, next) => { context.header('Cache-Control', 'no-store'); await next(); });

sightSingingResultRoutes.get(path, async context => {
  const { choirId, questionId } = context.req.param();
  const db = context.env.DB;
  const member = await readPermissionMember(db, await resolveContextPrincipal(context), choirId);
  const id = z.uuid().safeParse(questionId);
  const version = z.coerce.number().int().positive().safeParse(context.req.query('version'));
  if (!id.success || !version.success) return context.json({ error: 'invalid_question_version' }, 400);
  if (!await hasQuestionVersion(db, choirId, id.data, version.data, member.id)) return context.json({ error: 'question_version_not_found' }, 404);
  const rows = await db.prepare(`SELECT ${resultColumns} ${resultRows}
    WHERE result.choir_id = ? AND result.question_id = ? AND result.version = ? AND ${activeActor}
    ORDER BY result.rowid DESC`)
    .bind(member.id, choirId, id.data, version.data, member.id).all<ResultRow>();
  return context.json({ results: rows.results.map(serialize) });
});

sightSingingResultRoutes.post(path, bodyLimit({ maxSize: 4096 }), async context => {
  const { choirId, questionId } = context.req.param();
  const db = context.env.DB;
  const member = await readPermissionMember(db, await resolveContextPrincipal(context), choirId);
  if (context.req.header('x-same-page-owner-user-id') !== member.userId) throw new AuthorizationError();
  const id = z.uuid().safeParse(questionId);
  const submission = sightSingingResultSubmissionSchema.safeParse(await context.req.json().catch(() => null));
  if (!id.success || !submission.success) return context.json({ error: 'invalid_result' }, 400);
  const { id: resultId, version, score, voiceId, voiceName } = submission.data;
  if (!await hasQuestionVersion(db, choirId, id.data, version, member.id)) return context.json({ error: 'question_version_not_found' }, 404);
  const limited = await limitDriveMutation(context, member.userId, 'publish-sight-singing-result', 30);
  if (limited) return limited;

  // The source version and membership must still be usable when the write runs.
  // Match the whole prior submission on retry so the key cannot replace a score.
  const insert = db.prepare(`INSERT INTO sight_singing_results(choir_id, question_id, version, id, membership_id, score, voice_id, voice_name)
    SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE ${activeActor} AND ${exactVersion} ON CONFLICT(choir_id, question_id, id) DO NOTHING`)
    .bind(choirId, id.data, version, resultId, member.id, score, voiceId, voiceName, member.id, choirId, id.data, version);
  const verify = db.prepare(`SELECT ${resultColumns} ${resultRows}
    WHERE result.choir_id = ? AND result.question_id = ? AND result.version = ? AND result.id = ?
      AND result.membership_id = ? AND result.score = ? AND result.voice_id = ? AND result.voice_name = ? AND ${activeActor}`)
    .bind(member.id, choirId, id.data, version, resultId, member.id, score, voiceId, voiceName, member.id);
  const [, committed] = await db.batch<ResultRow>([insert, verify]);
  const row = committed.results[0];
  if (row) return context.json({ result: serialize(row) });
  if (!await hasQuestionVersion(db, choirId, id.data, version, member.id)) return context.json({ error: 'question_version_not_found' }, 404);
  return context.json({ error: 'result_conflict' }, 409);
});
