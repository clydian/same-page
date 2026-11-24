import { validateMusicXmlSource } from '@same-page/player/format';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { attachmentFormat, attachmentNameSchema } from '../../src/shared/attachments';
import {
  publishQuestionSchema, reuseQuestionSnapshotSchema, SIGHT_SINGING_SCORE_MAX_BYTES, uploadQuestionSchema,
  type PublishedQuestion, type QuestionPublication,
} from '../../src/shared/sight-singing';
import { AttachmentError } from '../attachments/storage';
import { AuthorizationError } from '../auth/authorization';
import { resolveContextPrincipal } from '../auth/context-principal';
import type { AppEnvironment } from '../env';
import { memberCapabilities, operationPredicate, readPermissionMember, type PermissionMember } from '../permissions/access';
import { serveStoredFile } from '../scores/serve-file';
import { limitDriveMutation } from '../security/drive-rate-limit';

const base = '/choirs/:choirId/sight-singing/questions';
const publishPermission = 'editDriveInfo' as const;
const activeDrive = 'EXISTS (SELECT 1 FROM choirs WHERE id = ? AND is_preview_entry = 0 AND purged_at IS NULL)';
const librarySource = `FROM score_attachments a JOIN scores s ON s.id = a.score_id AND s.choir_id = a.choir_id
  JOIN score_attachment_files f ON f.id = a.current_file_id AND f.attachment_id = a.id AND f.state = 'ready' AND f.purged_at IS NULL
  WHERE a.choir_id = ? AND a.score_id = ? AND a.id = ? AND a.revision = ? AND a.kind = 'musicxml'
  AND a.trashed_at IS NULL AND a.purged_at IS NULL AND s.trashed_at IS NULL AND s.purged_at IS NULL AND s.current_version_id IS NOT NULL`;
const columns = `id, title, score_id AS scoreId, attachment_id AS attachmentId, attachment_revision AS revision, first_visit AS first, last_visit AS last,
  version, write_id AS writeId, publication, publisher_membership_id AS publisherMembershipId, publisher_name AS publisherName`;
const questionSelection = `SELECT q.id, q.title, q.score_id AS scoreId, q.attachment_id AS attachmentId, q.attachment_revision AS revision,
  q.first_visit AS first, q.last_visit AS last, q.version, snapshot.name AS snapshotName,
  v.snapshot_id AS snapshotId, v.fingerprint, q.write_id AS writeId,
  q.publication, q.publisher_membership_id AS publisherMembershipId, q.publisher_name AS publisherName
  FROM sight_singing_questions q JOIN sight_singing_question_versions v
    ON v.choir_id = q.choir_id AND v.question_id = q.id AND v.version = q.version
  JOIN sight_singing_score_snapshots snapshot ON snapshot.choir_id = v.choir_id AND snapshot.id = v.snapshot_id`;

type Source = { kind: 'library'; scoreId: string; attachmentId: string; revision: number }
  | { kind: 'reuse' }
  | { kind: 'upload'; file: File };
type Publication = { title: string; first: number; last: number; expectedVersion: number | null; expectedEditToken?: string;
  publication?: QuestionPublication; source: Source };
type QuestionRow = Omit<PublishedQuestion, 'snapshot' | 'publisher' | 'canEdit'> & {
  snapshotName: string | null; snapshotId: string | null; fingerprint: string | null; writeId: string | null;
  publication: QuestionPublication; publisherMembershipId: string | null; publisherName: string | null;
};

const actorFor = (member: PermissionMember) => ({
  id: member.id, canPublishOfficial: memberCapabilities(member).operations.operations.includes(publishPermission),
});
type Actor = ReturnType<typeof actorFor>;
const canEdit = (row: Pick<QuestionRow, 'publication' | 'publisherMembershipId'>, actor: Actor) => row.publication === 'official'
  ? actor.canPublishOfficial : row.publisherMembershipId === actor.id;

function serialize({ snapshotName, writeId, ...row }: QuestionRow, actor: Actor) {
  if (!snapshotName || !writeId) throw new Error('published_question_snapshot_missing');
  const { id, title, scoreId, attachmentId, revision, first, last, version } = row;
  const publisher = row.publication === 'official' ? { kind: 'official' }
    : { kind: 'member', name: row.publisherName ?? '', own: row.publisherMembershipId === actor.id };
  return { id, title, scoreId, attachmentId, revision, first, last, version,
    snapshot: { name: snapshotName, editToken: writeId }, publisher, canEdit: canEdit(row, actor) };
}

function boundedRequest(request: Request, maximum: number) {
  const declared = Number(request.headers.get('content-length'));
  if (declared > maximum) throw new AttachmentError('attachment_too_large', 413);
  if (!request.body) return null;
  let size = 0;
  const limited = request.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      size += chunk.byteLength;
      if (size > maximum) {
        throw new AttachmentError('attachment_too_large', 413);
      }
      controller.enqueue(chunk);
    },
  }));
  const body = new Response(limited, { headers: { 'content-type': request.headers.get('content-type') ?? '' } });
  const malformed = () => {
    if (size > maximum) throw new AttachmentError('attachment_too_large', 413);
    return null;
  };
  return { body, malformed };
}

async function readPublication(request: Request): Promise<Publication | null> {
  const upload = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() === 'multipart/form-data';
  const metadataLimit = 16 * 1024;
  const bounded = boundedRequest(request, upload ? SIGHT_SINGING_SCORE_MAX_BYTES + metadataLimit : metadataLimit);
  if (!bounded) return null;
  const { body, malformed } = bounded;
  if (upload) {
    const data = await body.formData().catch(malformed);
    const fields = data?.get('fields'), file = data?.get('file');
    if (typeof fields !== 'string' || fields.length > metadataLimit || !(file instanceof File)) return null;
    let json: unknown;
    try { json = JSON.parse(fields); } catch { return null; }
    const input = uploadQuestionSchema.safeParse(json);
    return input.success ? { ...input.data, source: { kind: 'upload', file } } : null;
  }
  const json = await body.json().catch(malformed);
  const reuse = reuseQuestionSnapshotSchema.safeParse(json);
  if (reuse.success) return { ...reuse.data, source: { kind: 'reuse' } };
  const library = publishQuestionSchema.safeParse(json);
  if (!library.success) return null;
  const { scoreId, attachmentId, revision, ...fields } = library.data;
  return { ...fields, source: { kind: 'library', scoreId, attachmentId, revision } };
}

async function readableMember(context: Context<AppEnvironment>, choirId: string) {
  const db = context.env.DB;
  const member = await readPermissionMember(db, await resolveContextPrincipal(context), choirId);
  if (!await db.prepare(`SELECT 1 WHERE ${activeDrive}`).bind(choirId).first()) throw new AuthorizationError();
  return member;
}

const readCurrent = (db: D1Database, choirId: string, questionId: string) => db.prepare(`${questionSelection} WHERE q.choir_id = ? AND q.id = ?`)
  .bind(choirId, questionId).first<QuestionRow>();

const scoreFormat = (file: File) => {
  const name = attachmentNameSchema.safeParse(file.name);
  if (!name.success) throw new AttachmentError('attachment_type_unsupported', 415);
  const format = attachmentFormat(name.data);
  if (!format || format.kind !== 'musicxml') throw new AttachmentError('attachment_type_unsupported', 415);
  if (file.size === 0 || file.size > SIGHT_SINGING_SCORE_MAX_BYTES) throw new AttachmentError('attachment_too_large', 413);
  return { name: name.data, contentType: format.contentType };
};

async function initializeSource(context: Context<AppEnvironment>, choirId: string, input: Publication) {
  const { source, title, first, last } = input;
  let upload: { name: string; contentType: string; bytes: ArrayBuffer } | undefined;
  let provenance: unknown;
  if (source.kind === 'upload') {
    const format = scoreFormat(source.file);
    const bytes = await source.file.arrayBuffer();
    try { validateMusicXmlSource(new Uint8Array(bytes)); }
    catch { throw new AttachmentError('invalid_musicxml', 422); }
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
    upload = { ...format, bytes };
    provenance = ['upload', format.name, hash];
  } else if (source.kind === 'library') {
    provenance = ['library', source.scoreId, source.attachmentId, source.revision];
  } else provenance = ['reuse', input.expectedVersion];
  const fingerprint = JSON.stringify([title, first, last, input.expectedEditToken ?? null, provenance]);
  return {
    fingerprint,
    load: async () => {
      if (upload) return { ...upload, objectKey: null };
      if (source.kind !== 'library') return null;
      const row = await context.env.DB.prepare(`SELECT a.name, f.content_type AS contentType, f.object_key AS objectKey, f.size_bytes AS sizeBytes ${librarySource}`)
        .bind(choirId, source.scoreId, source.attachmentId, source.revision)
        .first<{ name: string; contentType: string; objectKey: string; sizeBytes: number }>();
      if (!row) return null;
      const object = await context.env.SCORES_BUCKET.get(row.objectKey);
      if (!object || object.size !== row.sizeBytes || object.size <= 0 || object.size > SIGHT_SINGING_SCORE_MAX_BYTES) {
        await object?.body.cancel().catch(() => undefined);
        return null;
      }
      return { name: row.name, contentType: row.contentType, bytes: await object.arrayBuffer(), objectKey: row.objectKey };
    },
  };
}

async function removeAbandonedSnapshot(db: D1Database, snapshot: { id: string; key: string; platformBytes: number }, choirId: string) {
  const unreferenced = 'NOT EXISTS (SELECT 1 FROM sight_singing_question_versions WHERE choir_id = ? AND snapshot_id = ?)';
  await db.batch([
    // Rotate the cleanup identity in case its worker ran before a late R2 write.
    db.prepare(`INSERT INTO score_object_deletions(id, object_key, platform_bytes) SELECT ?, ?, ? WHERE ${unreferenced}
      ON CONFLICT(object_key) DO UPDATE SET id = excluded.id, platform_bytes = MAX(platform_bytes, excluded.platform_bytes)`)
      .bind(crypto.randomUUID(), snapshot.key, snapshot.platformBytes, choirId, snapshot.id),
    db.prepare(`DELETE FROM sight_singing_score_snapshots WHERE choir_id = ? AND id = ? AND ${unreferenced}`)
      .bind(choirId, snapshot.id, choirId, snapshot.id),
  ]);
}

export const sightSingingRoutes = new Hono<AppEnvironment>();
sightSingingRoutes.use(base, async (context, next) => { context.header('Cache-Control', 'no-store'); await next(); });
sightSingingRoutes.use(`${base}/*`, async (context, next) => { context.header('Cache-Control', 'no-store'); await next(); });

sightSingingRoutes.get(base, async context => {
  const choirId = context.req.param('choirId'), db = context.env.DB;
  const member = await readableMember(context, choirId);
  const actor = actorFor(member);
  const rows = await db.prepare(`${questionSelection} WHERE q.choir_id = ?
    AND EXISTS (SELECT 1 FROM membership_capabilities WHERE id = ?) ORDER BY q.title, q.id`)
    .bind(choirId, member.id).all<QuestionRow>();
  return context.json({ questions: rows.results.map(row => serialize(row, actor)) });
});

sightSingingRoutes.on(['GET', 'HEAD'], `${base}/:id/score`, async context => {
  const choirId = context.req.param('choirId'), db = context.env.DB;
  const member = await readableMember(context, choirId);
  const id = z.uuid().safeParse(context.req.param('id'));
  const version = z.coerce.number().int().positive().optional().safeParse(context.req.query('version'));
  if (!id.success || !version.success) return context.json({ error: 'invalid_question' }, 400);
  const row = await db.prepare(`SELECT snapshot.object_key AS objectKey, snapshot.size_bytes AS sizeBytes, snapshot.content_type AS contentType,
    snapshot.etag, snapshot.name FROM sight_singing_question_versions v JOIN sight_singing_questions q ON q.id = v.question_id AND q.choir_id = v.choir_id
    JOIN sight_singing_score_snapshots snapshot ON snapshot.id = v.snapshot_id AND snapshot.choir_id = v.choir_id
    WHERE v.choir_id = ? AND v.question_id = ? AND v.version = COALESCE(?, q.version) AND snapshot.etag IS NOT NULL
      AND EXISTS (SELECT 1 FROM membership_capabilities WHERE id = ?)`)
    .bind(choirId, id.data, version.data ?? null, member.id)
    .first<{ objectKey: string; sizeBytes: number; contentType: string; etag: string; name: string }>();
  if (!row) return context.json({ error: 'question_score_not_found' }, 404);
  return serveStoredFile(context, { ...row, headers: { 'Cache-Control': 'no-store', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(row.name).replace(/'/g, '%27')}` } });
});

sightSingingRoutes.put(`${base}/:id`, async context => {
  const choirId = context.req.param('choirId'), db = context.env.DB;
  const member = await readableMember(context, choirId);
  if (context.req.header('x-same-page-owner-user-id') !== member.userId) throw new AuthorizationError();
  const id = z.uuid().safeParse(context.req.param('id'));
  if (!id.success) return context.json({ error: 'invalid_question' }, 400);
  const limited = await limitDriveMutation(context, member.userId, 'publish-sight-singing-question', 30);
  if (limited) return limited;
  const input = await readPublication(context.req.raw);
  if (!input) return context.json({ error: 'invalid_question' }, 400);

  const { source, title, first, last, expectedVersion, expectedEditToken } = input;
  const actor = actorFor(member);
  const version = (expectedVersion ?? 0) + 1;
  const conflict = () => context.json({ error: 'question_conflict' }, 409);
  const current = await readCurrent(db, choirId, id.data);
  const publication = current?.publication ?? input.publication ?? 'member';
  if ((current && !canEdit(current, actor)) || (publication === 'official' && !actor.canPublishOfficial)) throw new AuthorizationError();
  if (input.publication && input.publication !== publication) return conflict();
  const { fingerprint, load } = await initializeSource(context, choirId, input);
  if (current?.version === version && current.fingerprint === fingerprint) return context.json({ question: serialize(current, actor) });
  if ((current?.version ?? null) !== expectedVersion) return conflict();
  const memberPermission = 'EXISTS (SELECT 1 FROM membership_capabilities WHERE id = ?)';
  const permission = `${publication === 'official' ? operationPredicate(publishPermission) : memberPermission} AND ${activeDrive}`;
  const permissionValues = [member.id, choirId];
  if (source.kind === 'reuse' && current?.snapshotName && current.first === first && current.last === last) {
    // A different title leaves the exercise and its published results on the same version.
    if (current.title === title) return context.json({ question: serialize(current, actor) });
    const renamed = await db.prepare(`UPDATE sight_singing_questions SET title = ?, write_id = ?
      WHERE choir_id = ? AND id = ? AND version = ? AND write_id = ? AND ${permission} RETURNING ${columns}`)
      .bind(title, crypto.randomUUID(), choirId, id.data, expectedVersion, expectedEditToken ?? null, ...permissionValues).first<QuestionRow>();
    return renamed ? context.json({ question: serialize({ ...renamed, snapshotName: current.snapshotName }, actor) }) : conflict();
  }
  if (current && current.writeId !== expectedEditToken) return conflict();

  let snapshotId = current?.snapshotId ?? null;
  let snapshotName = current?.snapshotName ?? null;
  const origin = source.kind === 'reuse' ? [current?.scoreId ?? null, current?.attachmentId ?? null, current?.revision ?? null]
    : source.kind === 'library' ? [source.scoreId, source.attachmentId, source.revision] : [null, null, null];
  let sourceKey: string | null = null;
  let reserved: { id: string; key: string; platformBytes: number } | undefined;
  let etag: string | null = null;
  try {
    if (source.kind !== 'reuse') {
      const candidate = await load();
      if (!candidate) return conflict();
      const snapshot = crypto.randomUUID();
      const key = `choirs/${choirId}/sight-singing/${snapshot}`;
      const reservation = await db.prepare(`INSERT INTO sight_singing_score_snapshots(choir_id, id, object_key, name, size_bytes, content_type, created_at)
        SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${permission}
        RETURNING CASE WHEN EXISTS (SELECT 1 FROM choirs WHERE id = ? AND plan = 'free') THEN size_bytes ELSE 0 END AS platformBytes`)
        .bind(choirId, snapshot, key, candidate.name, candidate.bytes.byteLength, candidate.contentType, Date.now(), ...permissionValues, choirId)
        .first<{ platformBytes: number }>();
      if (!reservation) return conflict();
      reserved = { id: snapshot, key, platformBytes: reservation.platformBytes };
      const object = await context.env.SCORES_BUCKET.put(key, candidate.bytes, { httpMetadata: { contentType: candidate.contentType } });
      if (!object) throw new Error('question_score_upload_failed');
      etag = object.httpEtag;
      sourceKey = candidate.objectKey;
      snapshotId = snapshot;
      snapshotName = candidate.name;
    }
    if (!snapshotId || !snapshotName) return conflict();

    const writeId = crypto.randomUUID();
    const guard = `${permission} AND EXISTS (SELECT 1 FROM sight_singing_score_snapshots WHERE choir_id = ? AND id = ? AND etag IS NOT NULL)
      ${source.kind === 'library' ? `AND EXISTS (SELECT 1 ${librarySource} AND f.object_key = ?)` : ''}`;
    const guardValues = [...permissionValues, choirId, snapshotId, ...(source.kind === 'library' ? [choirId, source.scoreId, source.attachmentId, source.revision, sourceKey] : [])];
    const fields = [title, ...origin, first, last, version, writeId];
    const update = expectedVersion === null
      ? db.prepare(`INSERT INTO sight_singing_questions(choir_id, id, title, score_id, attachment_id, attachment_revision, first_visit,
          last_visit, version, write_id, publication, publisher_membership_id, publisher_name)
          SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${guard} ON CONFLICT(choir_id, id) DO NOTHING RETURNING ${columns}`)
        .bind(choirId, id.data, ...fields, publication, publication === 'member' ? member.id : null,
          publication === 'member' ? member.displayName : null, ...guardValues)
      : db.prepare(`UPDATE sight_singing_questions SET title = ?, score_id = ?, attachment_id = ?, attachment_revision = ?, first_visit = ?, last_visit = ?, version = ?, write_id = ?
          WHERE choir_id = ? AND id = ? AND version = ? AND write_id = ? AND ${guard} RETURNING ${columns}`)
        .bind(...fields, choirId, id.data, expectedVersion, expectedEditToken, ...guardValues);
    const [question] = (await db.batch<QuestionRow>([
      ...(reserved ? [db.prepare('UPDATE sight_singing_score_snapshots SET etag = ? WHERE choir_id = ? AND id = ? AND etag IS NULL').bind(etag, choirId, reserved.id)] : []),
      update,
      db.prepare(`INSERT INTO sight_singing_question_versions(choir_id, question_id, version, snapshot_id, title, first_visit, last_visit, fingerprint)
        SELECT choir_id, id, version, ?, title, first_visit, last_visit, ? FROM sight_singing_questions WHERE choir_id = ? AND id = ? AND write_id = ?`)
        .bind(snapshotId, fingerprint, choirId, id.data, writeId),
    ])).at(-2)!.results;
    if (question) {
      reserved = undefined;
      return context.json({ question: serialize({ ...question, snapshotName }, actor) });
    }
    const committed = await readCurrent(db, choirId, id.data);
    return committed?.version === version && committed.publication === publication && canEdit(committed, actor) && committed.fingerprint === fingerprint
      ? context.json({ question: serialize(committed, actor) }) : conflict();
  } finally {
    if (reserved) await removeAbandonedSnapshot(db, reserved, choirId).catch(() => undefined);
  }
});
