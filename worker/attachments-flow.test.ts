import { createLocalAccountIssuer } from "@better-auth/core/db";
import { hashPassword } from "better-auth/crypto";
import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, expect, it, vi } from "vitest";
import worker from "./index";
import { provisionChoir } from "./choirs/provision";
import { cleanupScoreStorage } from "./scores/cleanup";
import { saveAttachmentFile } from "./attachments/storage";

let choirId: string, scoreId: string, memberId: string, cookie: string;
const mainBytes = new TextEncoder().encode("%PDF-1.4 main score fixture");
const password = "attachment-test-password";
const passwordHash = await hashPassword(password);
const wav = new TextEncoder().encode("RIFF0000WAVEfmt fixture audio bytes");
async function call(path: string, init: RequestInit = {}) {
  const execution = createExecutionContext();
  const response = await worker.fetch(new Request(`https://same-page.test${path}`, { ...init, headers: { ...(cookie ? { cookie } : {}), ...init.headers } }), env, execution);
  await waitOnExecutionContext(execution);
  if (response.body) return new Response(await response.arrayBuffer(), { status: response.status, headers: response.headers });
  return response;
}
const base = () => `/api/choirs/${choirId}/scores/${scoreId}/attachments`;
const list = () => call(`/api/choirs/${choirId}/attachments?scoreIds=${scoreId}`);
const json = (body: unknown) => ({ headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
async function upload(name: string, content: string | Uint8Array, id = crypto.randomUUID(), revision?: number) {
  const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
  const query = new URLSearchParams({ name, size: String(bytes.length), ...(revision ? { expectedRevision: String(revision) } : {}) });
  const response = await call(`${base()}/${id}/file?${query}`, { method: revision ? "PUT" : "POST", headers: { "content-length": String(bytes.length) }, body: bytes });
  return { response, id };
}
async function usage() { return (await env.DB.prepare("SELECT storage_used_bytes AS bytes FROM choirs WHERE id = ?").bind(choirId).first<{ bytes: number }>())!.bytes; }

beforeEach(async () => {
  vi.restoreAllMocks();
  await env.DB.batch(["DELETE FROM choirs", "DELETE FROM rate_limits", "DELETE FROM session", "DELETE FROM account", "DELETE FROM user", "DELETE FROM score_object_deletions"].map(sql => env.DB.prepare(sql)));
  await env.DB.prepare("UPDATE drive_platform_limits SET retained_pdf_limit_bytes = 21474836480 WHERE id = 1").run();
  const userId = crypto.randomUUID();
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, '测试用户', 'attachment@example.test', 1, ?, ?)").bind(userId, now, now),
    env.DB.prepare("INSERT INTO account (id, issuer, account_id, provider_id, user_id, password, created_at, updated_at) VALUES (?, ?, ?, 'credential', ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), createLocalAccountIssuer("credential"), userId, userId, passwordHash, now, now),
  ]);
  const provisioned = await provisionChoir({ binding: env.DB, ownerUserId: userId, ownerDisplayName: "附件测试", inviteSecret: env.INVITE_SECRET });
  choirId = provisioned.choirId; scoreId = crypto.randomUUID();
  memberId = (await env.DB.prepare("SELECT owner_membership_id AS id FROM choirs WHERE id = ?").bind(choirId).first<{ id: string }>())!.id;
  const versionId = crypto.randomUUID();
  const object = await env.SCORES_BUCKET.put(versionId, mainBytes);
  await env.DB.batch([
    env.DB.prepare("UPDATE choirs SET storage_used_bytes = ? WHERE id = ?").bind(mainBytes.length, choirId),
    env.DB.prepare("INSERT INTO scores (id, choir_id, file_name, file_name_key, current_version_id) VALUES (?, ?, '主谱.pdf', '主谱.pdf', ?)").bind(scoreId, choirId, versionId),
    env.DB.prepare("INSERT INTO score_versions (id, choir_id, score_id, version_number, object_key, size_bytes, sha256, etag, page_count, state) VALUES (?, ?, ?, 1, ?, ?, 'fixture', ?, 1, 'ready')")
      .bind(versionId, choirId, scoreId, versionId, mainBytes.length, object!.httpEtag),
  ]);
  cookie = "";
  const login = await call("/api/auth/sign-in/email", { method: "POST", ...json({ email: "attachment@example.test", password }) });
  expect(login.status, await login.clone().text()).toBe(200); cookie = login.headers.get("set-cookie")!.split(";")[0];
});

it("stores links, audio and Markdown against the score and serves authenticated byte ranges", async () => {
  expect((await call(base() + "/links", { method: "POST", ...json({ id: crypto.randomUUID(), name: "参考演唱", url: "https://example.org/reference" }) })).status).toBe(201);
  const audio = await upload("合唱示范.wav", wav); expect(audio.response.status, await audio.response.clone().text()).toBe(201);
  const md = await upload("排练笔记.md", "# 排练\n\n轻声进入。"); expect(md.response.status).toBe(201);
  expect((await list()).status).toBe(200);
  const bootstrap = await call(`/api/choirs/${choirId}/bootstrap`);
  expect(await bootstrap.json()).toMatchObject({ scores: [{ id: scoreId, attachmentCount: 3 }] });
  const range = await call(`${base()}/${audio.id}/file`, { headers: { Range: "bytes=4-9" } });
  expect(range.status).toBe(206); expect(range.headers.get("content-range")).toBe(`bytes 4-9/${wav.length}`);
  expect(new Uint8Array(await range.arrayBuffer())).toEqual(wav.slice(4, 10));
  expect((await call(`${base()}/${audio.id}/file`, { headers: { Range: "bytes=900-999" } })).status).toBe(416);
  expect((await call(`${base()}/${audio.id}/file`, { headers: { cookie: "" } })).status).toBe(403);
  const head = await call(`${base()}/${audio.id}/file`, { method: "HEAD" }); expect(head.status).toBe(200);
  expect((await call(`${base()}/${audio.id}/file`, { headers: { "If-None-Match": head.headers.get("etag")! } })).status).toBe(304);
  expect(await usage()).toBe(mainBytes.length + wav.length + new TextEncoder().encode("# 排练\n\n轻声进入。").length);
  expect((await env.DB.prepare("SELECT count(*) AS count FROM score_versions").first())).toEqual({ count: 1 });
});

it("rejects unsupported types, disguised files, invalid UTF-8 and oversized uploads without leaking reservations", async () => {
  for (const name of ["notes.txt", "notes.docx", "notes.exe"]) expect((await upload(name, "content")).response.status).toBe(415);
  expect((await upload("notes.pdf", "PK fake docx bytes")).response.status).toBe(415);
  expect((await upload("notes.md", new Uint8Array([0xff, 0xfe]))).response.status).toBe(422);
  const response = await call(`${base()}/${crypto.randomUUID()}/file?name=recording.wav&size=52428801`, { method: "POST" });
  expect(response.status).toBe(413);
  expect(await usage()).toBe(mainBytes.length);
  expect(await (await list()).json()).toEqual({ attachments: [] });
  await cleanupScoreStorage(env);
  expect((await env.DB.prepare("SELECT count(*) AS count FROM score_attachment_files").first())).toEqual({ count: 0 });
});

it("conditionally replaces Markdown and preserves one winner during concurrent saves", async () => {
  const original = await upload("笔记.md", "original"); expect(original.response.status).toBe(201);
  const results = await Promise.all([upload("笔记.md", "first update", original.id, 1), upload("笔记.md", "second update", original.id, 1)]);
  expect(results.map(result => result.response.status).sort()).toEqual([200, 409]);
  expect((await call(`${base()}/${original.id}/file?revision=1`)).status).toBe(409);
  const saved = await call(`${base()}/${original.id}/file?revision=2`); const text = await saved.text();
  expect(["first update", "second update"]).toContain(text);
  expect(await usage()).toBe(mainBytes.length + text.length);
  await cleanupScoreStorage(env);
  expect((await env.DB.prepare("SELECT count(*) AS count FROM score_attachment_files").first())).toEqual({ count: 1 });
});

it("retains quota in trash, restores attachments and follows parent purge without double releasing storage", async () => {
  const uploaded = await upload("笔记.md", "keep me"); expect(uploaded.response.status).toBe(201);
  expect((await call(`${base()}/${uploaded.id}?expectedRevision=1`, { method: "DELETE" })).status).toBe(204);
  expect(await usage()).toBe(mainBytes.length + 7);
  expect((await call(`${base()}/${uploaded.id}/file`)).status).toBe(404);
  expect((await (await call(`/api/choirs/${choirId}/attachments/trash`)).json())).toMatchObject({ attachments: [{ id: uploaded.id }] });
  expect((await call(`${base()}/${uploaded.id}/restore`, { method: "POST" })).status).toBe(204);
  expect((await call(`/api/choirs/${choirId}/scores/${scoreId}`, { method: "DELETE" })).status).toBe(204);
  expect((await call(`${base()}/${uploaded.id}/file`)).status).toBe(404);
  expect((await call(`/api/choirs/${choirId}/scores/${scoreId}/restore`, { method: "POST" })).status).toBe(204);
  expect((await call(`${base()}/${uploaded.id}/file`)).status).toBe(200);
  const file = await env.DB.prepare("SELECT object_key FROM score_attachment_files WHERE attachment_id = ?").bind(uploaded.id).first<{ object_key: string }>();
  const now = Date.now();
  await env.DB.prepare("UPDATE scores SET trashed_at = ?, trash_expires_at = ?, purged_at = ? WHERE id = ?").bind(now, now + 30 * 86400000, now, scoreId).run();
  expect(await usage()).toBe(0);
  await cleanupScoreStorage(env, now + 31 * 86400000);
  expect(await usage()).toBe(0); expect(await env.SCORES_BUCKET.head(file!.object_key)).toBeNull();
});

it("enforces quotas for concurrent uploads and counts attachments in the free platform ceiling", async () => {
  await env.DB.prepare("UPDATE choirs SET storage_limit_bytes = ? WHERE id = ?").bind(mainBytes.length + 10, choirId).run();
  const uploads = await Promise.all([upload("one.md", "12345678"), upload("two.md", "12345678")]);
  expect(uploads.map(value => value.response.status).sort()).toEqual([201, 409]);
  expect(await usage()).toBe(mainBytes.length + 8);
  await env.DB.prepare("UPDATE choirs SET plan = 'free', storage_limit_bytes = 52428800 WHERE id = ?").bind(choirId).run();
  await env.DB.prepare("UPDATE drive_platform_limits SET retained_pdf_limit_bytes = ? WHERE id = 1").bind(mainBytes.length + 10).run();
  const limited = await upload("three.md", "123"); expect(limited.response.status).toBe(409);
  expect(await limited.response.json()).toEqual({ error: "platform_storage_limit_reached" });
  await env.DB.prepare("UPDATE drive_platform_limits SET retained_pdf_limit_bytes = 21474836480 WHERE id = 1").run();
});

it("rechecks parent availability at upload completion and durably removes failed objects", async () => {
  const put = env.SCORES_BUCKET.put.bind(env.SCORES_BUCKET);
  vi.spyOn(env.SCORES_BUCKET, "put").mockImplementationOnce(async (...args) => {
    const stored = await put(...args);
    await env.DB.prepare("UPDATE scores SET trashed_at = ?, trash_expires_at = ? WHERE id = ?").bind(Date.now(), Date.now() + 86400000, scoreId).run();
    return stored;
  });
  const result = await upload("笔记.md", "not published"); expect(result.response.status).toBe(409);
  expect(await usage()).toBe(mainBytes.length);
  await cleanupScoreStorage(env);
  expect((await env.DB.prepare("SELECT count(*) AS count FROM score_attachment_files").first())).toEqual({ count: 0 });
});

it("does not keep streaming when R2 rejects the upload", async () => {
  vi.spyOn(env.SCORES_BUCKET, "put").mockRejectedValueOnce(new Error("bucket unavailable"));
  await expect(saveAttachmentFile({ env, choirId, scoreId, membershipId: memberId, attachmentId: crypto.randomUUID(), name: "笔记.md", size: 5, body: new Blob(["hello"]).stream() })).rejects.toThrow();
  expect(await usage()).toBe(mainBytes.length);
});

it("does not publish an upload after the uploader loses membership", async () => {
  const successorId = crypto.randomUUID();
  const successorMemberId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, '接任用户', 'successor@example.test', 1, 1, 1)").bind(successorId),
    env.DB.prepare("INSERT INTO memberships (id, choir_id, user_id, display_name) VALUES (?, ?, ?, '接任用户')").bind(successorMemberId, choirId, successorId),
  ]);
  const put = env.SCORES_BUCKET.put.bind(env.SCORES_BUCKET);
  vi.spyOn(env.SCORES_BUCKET, "put").mockImplementationOnce(async (...args) => {
    const stored = await put(...args);
    await env.DB.batch([
      env.DB.prepare("UPDATE choirs SET owner_membership_id = ? WHERE id = ?").bind(successorMemberId, choirId),
      env.DB.prepare("UPDATE memberships SET status = 'removed' WHERE id = ?").bind(memberId),
    ]);
    return stored;
  });
  const result = await upload("笔记.md", "revoked while uploading");
  expect(result.response.status).toBe(409);
  expect(await usage()).toBe(mainBytes.length);
  expect((await list()).status).toBe(403);
  await cleanupScoreStorage(env);
  expect(await env.DB.prepare("SELECT count(*) AS count FROM score_attachment_files").first()).toEqual({ count: 0 });
});

it("queues a late R2 object even if pending-upload cleanup already removed its reservation", async () => {
  const put = env.SCORES_BUCKET.put.bind(env.SCORES_BUCKET);
  let objectKey = "";
  vi.spyOn(env.SCORES_BUCKET, "put").mockImplementationOnce(async (...args) => {
    objectKey = args[0];
    await env.DB.prepare("UPDATE score_attachment_files SET created_at = 0 WHERE state = 'pending'").run();
    await cleanupScoreStorage(env);
    return put(...args);
  });
  const result = await upload("笔记.md", "late upload");
  expect(result.response.status).toBe(409);
  expect(await usage()).toBe(mainBytes.length);
  expect(await env.DB.prepare("SELECT object_key FROM score_object_deletions WHERE object_key = ?").bind(objectKey).first()).toEqual({ object_key: objectKey });
  await cleanupScoreStorage(env);
  expect(await env.SCORES_BUCKET.head(objectKey)).toBeNull();
});

it("returns the committed revision even when another editor saves before the response", async () => {
  const original = await upload("笔记.md", "original");
  const batch = env.DB.batch.bind(env.DB);
  let batches = 0;
  vi.spyOn(env.DB, "batch").mockImplementation(async statements => {
    const result = await batch(statements);
    if (++batches === 2) {
      await saveAttachmentFile({ env, choirId, scoreId, membershipId: memberId, attachmentId: original.id,
        name: "笔记.md", size: 6, body: new Blob(["second"]).stream(), expectedRevision: 2 });
    }
    return result;
  });
  const first = await upload("笔记.md", "first", original.id, 1);
  expect(first.response.status).toBe(200);
  const saved = await first.response.json() as { attachment: { revision: number; sizeBytes: number } };
  expect(saved.attachment).toMatchObject({ revision: 2, sizeBytes: 5 });
  expect((await upload("笔记.md", "first next", original.id, saved.attachment.revision)).response.status).toBe(409);
  expect(await (await call(`${base()}/${original.id}/file?revision=3`)).text()).toBe("second");
});

it("reads a full 100-score batch without exceeding D1 bound parameters", async () => {
  await upload("笔记.md", "batch");
  const ids = [scoreId, ...Array.from({ length: 99 }, () => crypto.randomUUID())];
  const response = await call(`/api/choirs/${choirId}/attachments?scoreIds=${ids.join(",")}`);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ attachments: [{ scoreId, name: "笔记.md" }] });
  expect((await call(`/api/choirs/${choirId}/attachments?scoreIds=${[...ids, crypto.randomUUID()].join(",")}`)).status).toBe(400);
});

it("counts replaced objects until physical cleanup succeeds, including failed deletion retries", async () => {
  await env.DB.prepare("UPDATE choirs SET plan = 'free' WHERE id = ?").bind(choirId).run();
  await env.DB.prepare("UPDATE drive_platform_limits SET retained_pdf_limit_bytes = ? WHERE id = 1").bind(mainBytes.length + 20).run();
  const first = await upload("笔记.md", "0123456789");
  const oldFile = await env.DB.prepare("SELECT object_key FROM score_attachment_files WHERE attachment_id = ?").bind(first.id).first<{ object_key: string }>();
  expect((await upload("笔记.md", "1234567890", first.id, 1)).response.status).toBe(200);
  expect(await usage()).toBe(mainBytes.length + 10);
  expect(await env.DB.prepare("SELECT bytes FROM free_file_storage_usage").first()).toEqual({ bytes: mainBytes.length + 20 });
  expect((await upload("笔记.md", "2345678901", first.id, 2)).response.status).toBe(409);
  vi.spyOn(env.SCORES_BUCKET, "delete").mockRejectedValueOnce(new Error("temporary deletion failure"));
  await expect(cleanupScoreStorage(env)).rejects.toThrow("temporary deletion failure");
  expect((await upload("笔记.md", "2345678901", first.id, 2)).response.status).toBe(409);
  await cleanupScoreStorage(env);
  expect(await env.SCORES_BUCKET.head(oldFile!.object_key)).toBeNull();
  expect(await env.DB.prepare("SELECT bytes FROM free_file_storage_usage").first()).toEqual({ bytes: mainBytes.length + 10 });
  expect((await upload("笔记.md", "2345678901", first.id, 2)).response.status).toBe(200);
});

it("keeps physical usage after a free drive and its file metadata are deleted", async () => {
  await env.DB.prepare("UPDATE choirs SET plan = 'free' WHERE id = ?").bind(choirId).run();
  await upload("笔记.md", "0123456789");
  await env.DB.prepare("DELETE FROM choirs WHERE id = ?").bind(choirId).run();
  expect(await env.DB.prepare("SELECT bytes FROM free_file_storage_usage").first()).toEqual({ bytes: mainBytes.length + 10 });
  await cleanupScoreStorage(env);
  expect(await env.DB.prepare("SELECT bytes FROM free_file_storage_usage").first()).toEqual({ bytes: 0 });
});

it("distinguishes absent, pending, saved and trashed results without hiding authorization failures", async () => {
  const id = crypto.randomUUID();
  const recovery = (operation = "create", headers = {}) => call(`${base()}/${id}/recovery?operation=${operation}`, { headers });
  expect(await (await recovery()).json()).toEqual({ state: "absent" });
  expect((await recovery("create", { cookie: "" })).status).toBe(403);
  const put = env.SCORES_BUCKET.put.bind(env.SCORES_BUCKET);
  vi.spyOn(env.SCORES_BUCKET, "put").mockImplementationOnce(async (...args) => {
    expect(await (await recovery()).json()).toEqual({ state: "pending" });
    return put(...args);
  });
  expect((await upload("笔记.md", "hello", id)).response.status).toBe(201);
  expect(await (await recovery()).json()).toMatchObject({ state: "available", attachment: { id, revision: 1 } });
  await call(`${base()}/${id}?expectedRevision=1`, { method: "DELETE" });
  expect((await recovery()).status).toBe(404);
  expect(await (await recovery("trash")).json()).toEqual({ state: "trashed" });
  await call(`/api/choirs/${choirId}/scores/${scoreId}`, { method: "DELETE" });
  expect((await recovery("trash")).status).toBe(404);
});

it("does not acknowledge a newer cleanup request after a late upload finishes", async () => {
  await env.DB.prepare("UPDATE choirs SET plan = 'free' WHERE id = ?").bind(choirId).run();
  const put = env.SCORES_BUCKET.put.bind(env.SCORES_BUCKET);
  const remove = env.SCORES_BUCKET.delete.bind(env.SCORES_BUCKET);
  let objectKey = "";
  let started!: () => void;
  let allowPut!: () => void;
  const putStarted = new Promise<void>(resolve => { started = resolve; });
  const putGate = new Promise<void>(resolve => { allowPut = resolve; });
  vi.spyOn(env.SCORES_BUCKET, "put").mockImplementationOnce(async (...args) => {
    objectKey = args[0];
    await env.DB.prepare("UPDATE score_attachment_files SET created_at = 0 WHERE state = 'pending'").run();
    started(); await putGate;
    return put(...args);
  });
  const request = upload("笔记.md", "late upload");
  await putStarted;
  vi.spyOn(env.SCORES_BUCKET, "delete").mockImplementationOnce(async (...args) => {
    await remove(...args);
    allowPut();
    expect((await request).response.status).toBe(409);
  });
  await cleanupScoreStorage(env);
  expect(await env.DB.prepare("SELECT platform_bytes FROM score_object_deletions WHERE object_key = ?").bind(objectKey).first()).toEqual({ platform_bytes: 11 });
  expect(await env.SCORES_BUCKET.head(objectKey)).not.toBeNull();
  expect(await env.DB.prepare("SELECT bytes FROM free_file_storage_usage").first()).toEqual({ bytes: mainBytes.length + 11 });
  await cleanupScoreStorage(env);
  expect(await env.SCORES_BUCKET.head(objectKey)).toBeNull();
  expect(await env.DB.prepare("SELECT bytes FROM free_file_storage_usage").first()).toEqual({ bytes: mainBytes.length });
});
