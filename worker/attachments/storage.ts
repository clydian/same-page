import { attachmentFormat, attachmentSchema, type ScoreAttachment } from "../../src/shared/attachments";
import type { Env } from "../env";
import { operationPredicate } from "../permissions/access";

export class AttachmentError extends Error {
  constructor(public code: string, public status: 400 | 403 | 404 | 409 | 413 | 415 | 422 = 409) { super(code); }
}

// Validate bounded prefixes (or streaming UTF-8) without buffering a recording.
export function validateAttachmentStream(extension: string) {
  const decoder = extension === "md" ? new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }) : null;
  let prefix = new Uint8Array(0);
  let checked = false;
  const check = () => {
    const text = new TextDecoder("latin1").decode(prefix);
    const sync = prefix[0] === 0xff && (prefix[1] & 0xe0) === 0xe0;
    const valid = extension === "pdf" ? text.startsWith("%PDF-")
      : extension === "mp3" ? text.startsWith("ID3") || sync
      : extension === "aac" ? sync
      : extension === "m4a" ? text.slice(4, 8) === "ftyp"
      : extension === "wav" ? ["RIFF", "RF64"].includes(text.slice(0, 4)) && text.slice(8, 12) === "WAVE"
      : extension === "flac" ? text.startsWith("fLaC")
      : ["ogg", "opus"].includes(extension) && text.startsWith("OggS");
    if (!valid) throw new AttachmentError("attachment_content_mismatch", 415);
    checked = true;
  };
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      if (decoder) {
        try { if (decoder.decode(chunk, { stream: true }).includes("\0")) throw new Error(); }
        catch { throw new AttachmentError("invalid_markdown_encoding", 422); }
      } else if (!checked) {
        const next = new Uint8Array(Math.min(32, prefix.length + chunk.length));
        next.set(prefix); next.set(chunk.subarray(0, next.length - prefix.length), prefix.length); prefix = next;
        if (prefix.length >= 12) check();
      }
      controller.enqueue(chunk);
    },
    flush() {
      if (decoder) {
        try { decoder.decode(); } catch { throw new AttachmentError("invalid_markdown_encoding", 422); }
      } else if (!checked) check();
    },
  });
}

export async function saveAttachmentFile(options: {
  env: Env; choirId: string; scoreId: string; attachmentId: string; membershipId: string;
  name: string; size: number; body: ReadableStream<Uint8Array>; expectedRevision?: number;
}) {
  const { env, choirId, scoreId, attachmentId, membershipId, name, size, body, expectedRevision } = options;
  const format = attachmentFormat(name);
  if (!format) { await body.cancel().catch(() => undefined); throw new AttachmentError("attachment_type_unsupported", 415); }
  if (size > format.maxBytes || (size === 0 && format.kind !== "markdown")) { await body.cancel().catch(() => undefined); throw new AttachmentError("attachment_too_large", 413); }
  const creating = expectedRevision === undefined;
  if (!creating && format.kind !== "markdown") throw new AttachmentError("attachment_not_editable", 400);
  const operation = creating ? "uploadFiles" : "modifyFiles";
  const fileId = crypto.randomUUID();
  const objectKey = `choirs/${choirId}/scores/${scoreId}/attachments/${attachmentId}/${fileId}`;
  const now = Date.now();
  let reserved = false;
  let platformBytes = 0;
  try {
    const reservation = await env.DB.batch<{ platformBytes: number }>([
      ...(creating ? [env.DB.prepare(`INSERT INTO score_attachments (id, choir_id, score_id, kind, name, created_at, updated_at)
        SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${operationPredicate(operation)}`).bind(attachmentId, choirId, scoreId, format.kind, name, now, now, membershipId)] : []),
      env.DB.prepare(`INSERT INTO score_attachment_files (id, attachment_id, choir_id, object_key, size_bytes, content_type, created_at)
        SELECT ?, id, choir_id, ?, ?, ?, ? FROM score_attachments
        WHERE id = ? AND choir_id = ? AND score_id = ? AND revision = ? AND kind = ? AND ${operationPredicate(operation)}
        RETURNING id, CASE WHEN EXISTS (SELECT 1 FROM choirs WHERE id = score_attachment_files.choir_id AND plan = 'free') THEN size_bytes ELSE 0 END AS platformBytes`)
        .bind(fileId, objectKey, size, format.contentType, now, attachmentId, choirId, scoreId, expectedRevision ?? 1, format.kind, membershipId),
    ]);
    if (reservation.at(-1)?.results.length !== 1) throw new AttachmentError("attachment_conflict");
    reserved = true;
    platformBytes = Number(reservation.at(-1)!.results[0].platformBytes);
    const fixed = new FixedLengthStream(size);
    const transferAbort = new AbortController();
    const transfer = body.pipeThrough(validateAttachmentStream(format.extension)).pipeTo(fixed.writable, { signal: transferAbort.signal });
    // Observe both failures: aborted uploads must not leave unhandled stream work.
    const [sent, stored] = await Promise.allSettled([
      transfer,
      env.SCORES_BUCKET.put(objectKey, fixed.readable, { httpMetadata: { contentType: format.contentType } }).catch(error => { transferAbort.abort(); throw error; }),
    ]);
    if (sent.status === "rejected") throw sent.reason;
    if (stored.status === "rejected") throw stored.reason;
    if (!stored.value) throw new Error("attachment_upload_failed");
    const committed = await env.DB.batch<Omit<ScoreAttachment, "sizeBytes">>([
      env.DB.prepare(`UPDATE score_attachment_files SET state = 'ready', etag = ? WHERE id = ? AND state = 'pending' AND purged_at IS NULL`)
        .bind(stored.value.httpEtag, fileId),
      env.DB.prepare(`UPDATE score_attachments SET current_file_id = ?, name = ?, revision = revision + ?, updated_at = ?
        WHERE id = ? AND choir_id = ? AND score_id = ? AND revision = ? AND trashed_at IS NULL AND purged_at IS NULL
        AND EXISTS (SELECT 1 FROM score_attachment_files WHERE id = ? AND state = 'ready' AND purged_at IS NULL)
        AND EXISTS (SELECT 1 FROM scores WHERE id = ? AND trashed_at IS NULL AND purged_at IS NULL)
        AND ${operationPredicate(operation)} RETURNING id, score_id AS scoreId, kind, name, url, revision, updated_at AS updatedAt, trash_expires_at AS trashExpiresAt`)
        .bind(fileId, name, creating ? 0 : 1, Date.now(), attachmentId, choirId, scoreId, expectedRevision ?? 1, fileId, scoreId, membershipId),
    ]);
    if (committed[1].results.length !== 1) throw new AttachmentError("attachment_conflict");
    // This metadata belongs to the exact write, even if another editor commits
    // before the HTTP response is sent. Never pair our text with a later revision.
    return attachmentSchema.parse({ ...committed[1].results[0], sizeBytes: size });
  } catch (error) {
    if (reserved) {
      // Deleting the reservation durably queues R2 cleanup and releases quota.
      await env.DB.batch([
        // Refresh the queue identity: an in-flight cleanup may have deleted
        // before this late PUT and must not acknowledge this newer request.
        env.DB.prepare(`INSERT INTO score_object_deletions (id, object_key, platform_bytes) VALUES (?, ?, ?)
          ON CONFLICT(object_key) DO UPDATE SET id = excluded.id, platform_bytes = MAX(platform_bytes, excluded.platform_bytes)`)
          .bind(crypto.randomUUID(), objectKey, platformBytes),
        env.DB.prepare("DELETE FROM score_attachment_files WHERE id = ? AND NOT EXISTS (SELECT 1 FROM score_attachments WHERE current_file_id = ?)").bind(fileId, fileId),
        ...(creating ? [env.DB.prepare("DELETE FROM score_attachments WHERE id = ? AND current_file_id IS NULL").bind(attachmentId)] : []),
      ]).catch(() => undefined);
    }
    if (error instanceof AttachmentError) throw error;
    const messages: string[] = [];
    for (let cause = error, depth = 0; cause instanceof Error && depth < 5; cause = cause.cause, depth++) messages.push(cause.message);
    const code = ["choir_storage_quota_exceeded", "platform_storage_limit_reached", "attachment_limit_reached", "resource_deleted"].find(code => messages.some(message => message.includes(code)));
    if (code) throw new AttachmentError(code);
    if (messages.some(message => message.includes("UNIQUE constraint"))) throw new AttachmentError("attachment_conflict");
    throw error;
  }
}
