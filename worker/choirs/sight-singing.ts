import { Hono } from 'hono';
import { z } from 'zod';
import { publishQuestionSchema, type PublishedQuestion } from '../../src/shared/sight-singing';
import { AuthorizationError } from '../auth/authorization';
import { resolveContextPrincipal } from '../auth/context-principal';
import type { AppEnvironment } from '../env';
import { operationPredicate, readPermissionMember, requireOperation } from '../permissions/access';
import { limitDriveMutation } from '../security/drive-rate-limit';

const base = '/choirs/:choirId/sight-singing/questions';
const questionColumns = 'id, title, score_id AS scoreId, attachment_id AS attachmentId, attachment_revision AS revision, first_visit AS first, last_visit AS last, version';
const publishPermission = 'editDriveInfo' as const;
const activeDrive = 'EXISTS (SELECT 1 FROM choirs WHERE id = ? AND is_preview_entry = 0 AND purged_at IS NULL)';
const currentSource = `EXISTS (SELECT 1 FROM score_attachments a JOIN scores s ON s.id = a.score_id AND s.choir_id = a.choir_id
  JOIN score_attachment_files f ON f.id = a.current_file_id AND f.attachment_id = a.id AND f.state = 'ready' AND f.purged_at IS NULL
  WHERE a.choir_id = ? AND a.score_id = ? AND a.id = ? AND a.revision = ? AND a.kind = 'musicxml'
  AND a.trashed_at IS NULL AND a.purged_at IS NULL AND s.trashed_at IS NULL AND s.purged_at IS NULL AND s.current_version_id IS NOT NULL)`;

export const sightSingingRoutes = new Hono<AppEnvironment>();
sightSingingRoutes.use(base, async (context, next) => { context.header('Cache-Control', 'no-store'); await next(); });
sightSingingRoutes.use(`${base}/*`, async (context, next) => { context.header('Cache-Control', 'no-store'); await next(); });

sightSingingRoutes.get(base, async context => {
  const choirId = context.req.param('choirId'), db = context.env.DB;
  const member = await readPermissionMember(db, await resolveContextPrincipal(context), choirId);
  if (!await db.prepare(`SELECT 1 WHERE ${activeDrive}`).bind(choirId).first()) throw new AuthorizationError();
  const rows = await db.prepare(`SELECT ${questionColumns} FROM sight_singing_questions WHERE choir_id = ?
    AND EXISTS (SELECT 1 FROM membership_capabilities WHERE id = ?) ORDER BY title, id`)
    .bind(choirId, member.id).all<PublishedQuestion>();
  return context.json({ questions: rows.results });
});

sightSingingRoutes.put(`${base}/:id`, async context => {
  const choirId = context.req.param('choirId'), db = context.env.DB;
  const member = await requireOperation(db, await resolveContextPrincipal(context), choirId, publishPermission);
  if (context.req.header('x-same-page-owner-user-id') !== member.userId) throw new AuthorizationError();
  const id = z.uuid().safeParse(context.req.param('id'));
  const input = publishQuestionSchema.safeParse(await context.req.json().catch(() => null));
  if (!id.success || !input.success) return context.json({ error: 'invalid_question' }, 400);
  const limited = await limitDriveMutation(context, member.userId, 'publish-sight-singing-question', 30);
  if (limited) return limited;
  const { title, scoreId, attachmentId, revision, first, last, expectedVersion } = input.data;
  const values = [title, scoreId, attachmentId, revision, first, last] as const;
  const guard = `${operationPredicate(publishPermission)} AND ${activeDrive} AND ${currentSource}`;
  const guardValues = [member.id, choirId, choirId, scoreId, attachmentId, revision] as const;
  const question = expectedVersion === null
    ? await db.prepare(`INSERT INTO sight_singing_questions(choir_id, id, title, score_id, attachment_id, attachment_revision, first_visit, last_visit, version)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, 1 WHERE ${guard} ON CONFLICT(choir_id,id) DO NOTHING RETURNING ${questionColumns}`)
      .bind(choirId, id.data, ...values, ...guardValues).first<PublishedQuestion>()
    : await db.prepare(`UPDATE sight_singing_questions SET title = ?, score_id = ?, attachment_id = ?, attachment_revision = ?, first_visit = ?, last_visit = ?, version = version + 1
        WHERE choir_id = ? AND id = ? AND version = ? AND ${guard} RETURNING ${questionColumns}`)
      .bind(...values, choirId, id.data, expectedVersion, ...guardValues).first<PublishedQuestion>();
  // A retry after a lost response may already have written exactly this version.
  const committed = question ?? await db.prepare(`SELECT ${questionColumns} FROM sight_singing_questions
    WHERE choir_id = ? AND id = ? AND version = ? AND title = ? AND score_id = ? AND attachment_id = ?
    AND attachment_revision = ? AND first_visit = ? AND last_visit = ? AND ${guard}`)
    .bind(choirId, id.data, (expectedVersion ?? 0) + 1, ...values, ...guardValues).first<PublishedQuestion>();
  return committed ? context.json({ question: committed }) : context.json({ error: 'question_conflict' }, 409);
});
