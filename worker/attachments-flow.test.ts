import { hashPassword } from "better-auth/crypto";
import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { zipSync } from "fflate";
import { beforeEach, expect, it, vi } from "vitest";
import { SIGHT_SINGING_PROTOCOL_HEADER } from "../src/shared/sight-singing";
import { currentSingingScoringRule } from "../src/shared/sight-singing-results";
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
    env.DB.prepare("INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at) VALUES (?, ?, 'credential', ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), userId, userId, passwordHash, now, now),
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

const musicXml = new TextEncoder().encode('<score-partwise><part-list><score-part id="P1"><part-name>Alto</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure></part></score-partwise>');
it('publishes voice-neutral challenges only to active drive members and fences source and version changes', async () => {
  const { id: attachmentId, response } = await upload('练习.musicxml', musicXml);
  expect(response.status).toBe(201);
  const path = `/api/choirs/${choirId}/sight-singing/questions`, id = crypto.randomUUID(), now = Date.now();
  const owner = (await env.DB.prepare('SELECT user_id FROM memberships WHERE id = ?').bind(memberId).first<{ user_id: string }>())!.user_id;
  const reader = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO user (id,name,email,email_verified,created_at,updated_at) VALUES (?, '成员', 'sing-reader@example.test', 1, ?, ?)").bind(reader, now, now),
    env.DB.prepare("INSERT INTO account (id,account_id,provider_id,user_id,password,created_at,updated_at) VALUES (?,?,'credential',?,?,?,?)")
      .bind(crypto.randomUUID(), reader, reader, passwordHash, now, now),
  ]);
  const credentials = json({ email: 'sing-reader@example.test', password });
  const login = await call('/api/auth/sign-in/email', { method: 'POST', body: credentials.body, headers: { ...credentials.headers, cookie: '', origin: 'https://same-page.test' } });
  expect(login.status, await login.clone().text()).toBe(200);
  const readerCookie = login.headers.get('set-cookie')!.split(';')[0];
  const fields = { title: '排练题', scoreId, attachmentId, revision: 1, first: 0, last: 0, expectedVersion: null };
  const publish = (body: unknown = fields, user = owner, session = cookie) => call(`${path}/${id}`, {
    method: 'PUT', headers: { 'content-type': 'application/json', 'x-same-page-owner-user-id': user, cookie: session }, body: JSON.stringify(body),
  });
  expect((await call(path, { headers: { cookie: readerCookie } })).status).toBe(403);
  const ownerSave = await publish(); expect(ownerSave.status, await ownerSave.clone().text()).toBe(200);
  expect(await ownerSave.json()).toEqual({ question: { id, title: fields.title, scoreId, attachmentId, revision: 1, first: 0, last: 0, version: 1 } });
  expect(await (await publish()).json()).toMatchObject({ question: { version: 1 } });
  expect((await call(`${path}/${id}/score?version=1`, { headers: { cookie: readerCookie } })).status).toBe(403);
  await env.DB.prepare("INSERT INTO memberships(id,choir_id,user_id,display_name,status) VALUES (?,?,?,'成员','active')").bind(crypto.randomUUID(), choirId, reader).run();
  const visible = await call(path, { headers: { cookie: readerCookie } });
  expect(visible.headers.get('cache-control')).toBe('no-store');
  expect(await visible.json()).toMatchObject({ questions: [{ id, version: 1 }] });
  expect(new Uint8Array(await (await call(`${path}/${id}/score?version=1`, { headers: { cookie: readerCookie } })).arrayBuffer())).toEqual(musicXml);
  expect((await publish({ ...fields, expectedVersion: 1 }, reader, readerCookie)).status).toBe(403);
  const ownId = crypto.randomUUID(), protocol = { [SIGHT_SINGING_PROTOCOL_HEADER]: '3' };
  const memberFields = { ...fields, title: '团员题', publication: 'member' };
  const publishOwn = (body: unknown, author = reader, session = readerCookie, target = `${path}/${ownId}`) => call(target, {
    method: 'PUT', headers: { ...protocol, 'content-type': 'application/json', 'x-same-page-owner-user-id': author, cookie: session },
    body: JSON.stringify(body),
  });
  expect((await publishOwn({ ...memberFields, publication: 'official' })).status).toBe(403);
  expect((await publishOwn({ ...memberFields, publication: 'public' })).status).toBe(400);
  expect((await publishOwn({ ...memberFields, publisherName: '自称官方' })).status).toBe(400);
  const memberSave = await publishOwn(memberFields);
  expect(memberSave.status, await memberSave.clone().text()).toBe(200);
  const { question: own } = await memberSave.json<{ question: { snapshot: { editToken: string } } }>();
  expect(own).toMatchObject({ id: ownId, publisher: { kind: 'member', name: '成员', own: true }, canEdit: true });
  expect(await (await publishOwn(memberFields)).json()).toMatchObject({ question: own });
  const listing = await (await call(path, { headers: { ...protocol, cookie: readerCookie } })).json<{ questions: unknown[] }>();
  expect(listing.questions).toHaveLength(2);
  expect(listing.questions).toEqual(expect.arrayContaining([
    expect.objectContaining({ id, publisher: { kind: 'official' }, canEdit: false }),
    expect.objectContaining({ id: ownId, publisher: { kind: 'member', name: '成员', own: true } }),
  ]));
  expect(await (await call(path, { headers: protocol })).json()).toMatchObject({
    questions: expect.arrayContaining([expect.objectContaining({ id: ownId, publisher: { kind: 'member', name: '成员', own: false }, canEdit: false })]),
  });
  expect(await (await call(path, { headers: { [SIGHT_SINGING_PROTOCOL_HEADER]: '2' } })).json()).toMatchObject({ questions: [{ id }] });
  const edit = { title: '题名已改', first: 0, last: 0, expectedVersion: 1, expectedEditToken: own.snapshot.editToken, reuseSnapshot: true };
  expect((await publishOwn(edit, owner, cookie)).status).toBe(403);
  expect((await publishOwn({ ...edit, publication: 'official' })).status).toBe(409);
  expect(await (await publishOwn(edit)).json()).toMatchObject({ question: { title: edit.title, version: 1 } });
  expect((await call(`${path}/${ownId}/score`, { headers: { cookie: '' } })).status).toBe(403);
  expect(new Uint8Array(await (await call(`${path}/${ownId}/score`)).arrayBuffer())).toEqual(musicXml);
  const summary = { id: crypto.randomUUID(), version: 1, score: 95, voiceId: '0:0:0', voiceName: 'Alto', scoringRule: currentSingingScoringRule };
  const resultPath = `${path}/${ownId}/results`;
  const driveLeaderboard = `/api/choirs/${choirId}/sight-singing/leaderboard?podium=1&precision=2`;
  expect(await (await call(`${resultPath}?view=best`, { method: 'POST', ...json(summary),
    headers: { 'content-type': 'application/json', 'x-same-page-owner-user-id': reader, cookie: readerCookie } })).json()).toMatchObject({
    result: { id: summary.id, questionId: ownId, score: 95, own: true }, published: true,
  });
  expect(await (await call(`${resultPath}?view=best&version=1&voice=Alto`)).json()).toMatchObject({
    results: [{ id: summary.id, displayName: '成员', score: 95, own: false }],
  });
  expect(await (await call(driveLeaderboard)).json()).toMatchObject({
    results: [{ id: summary.id, questionId: ownId, score: 95 }], participants: [{ questionId: ownId, count: 1 }],
  });
  expect((await call(`${resultPath}?view=best`, { headers: { cookie: '' } })).status).toBe(403);

  const { choirId: other } = await provisionChoir({ binding: env.DB, ownerUserId: reader, ownerDisplayName: '其他团', inviteSecret: env.INVITE_SECRET });
  const otherPath = `/api/choirs/${other}/sight-singing/questions`;
  expect(await (await call(otherPath, { headers: { ...protocol, cookie: readerCookie } })).json()).toEqual({ questions: [] });
  expect((await call(`${otherPath}/${ownId}/score`, { headers: { cookie: readerCookie } })).status).toBe(404);
  expect((await call(`${otherPath}/${ownId}/results?view=best`, { headers: { cookie: readerCookie } })).status).toBe(404);
  expect((await publishOwn(memberFields, reader, readerCookie, `${otherPath}/${crypto.randomUUID()}`)).status).toBe(409);

  await env.DB.prepare('UPDATE memberships SET permissions = ? WHERE user_id = ? AND choir_id = ?')
    .bind(JSON.stringify({ operations: ['editDriveInfo'], sharedLayers: [] }), reader, choirId).run();
  expect((await publish({ ...fields, voice: '0:0:0' })).status).toBe(400);
  expect((await publish({ ...fields, expectedVersion: 1, revision: 2 }, reader, readerCookie)).status).toBe(409);
  expect(await (await publish({ ...fields, expectedVersion: 1, title: '更新题' }, reader, readerCookie)).json()).toMatchObject({ question: { title: '更新题', version: 2 } });
  expect((await publish({ ...fields, expectedVersion: 1, title: '旧版本' })).status).toBe(409);
});

it('freezes library MusicXML independently and keeps the original bytes when the attachment is replaced or deleted', async () => {
  const original = await uploadGenerated();
  expect(original.response.status).toBe(201);
  const path = `/api/choirs/${choirId}/sight-singing/questions/${crypto.randomUUID()}`;
  const owner = (await env.DB.prepare('SELECT user_id FROM memberships WHERE id = ?').bind(memberId).first<{ user_id: string }>())!.user_id;
  const headers = { 'x-same-page-owner-user-id': owner, [SIGHT_SINGING_PROTOCOL_HEADER]: '2' };
  const publish = (fields: unknown) => {
    const { body, headers: jsonHeaders } = json(fields);
    return call(path, { method: 'PUT', headers: { ...headers, ...jsonHeaders }, body });
  };
  const fields = { title: '定稿', scoreId, attachmentId: original.id, revision: 1, first: 0, last: 0, expectedVersion: null };
  expect(await (await publish(fields)).json()).toMatchObject({ question: { version: 1, snapshot: { name: '自动练习.musicxml' } } });
  const replacement = new TextEncoder().encode(new TextDecoder().decode(musicXml).replace('<step>C</step>', '<step>E</step>'));
  const query = new URLSearchParams({ size: String(replacement.length), name: '更新.musicxml', expectedRevision: '1', source: 'generated' });
  expect((await call(`${base()}/${original.id}/file?${query}`, { method: 'PUT', body: replacement })).status).toBe(200);
  expect(new Uint8Array(await (await call(`${path}/score?version=1`)).arrayBuffer())).toEqual(musicXml);
  expect((await publish({ ...fields, expectedVersion: 1 })).status).toBe(409);
  const updated = await publish({ ...fields, expectedVersion: 1, revision: 2 });
  expect(updated.status, await updated.clone().text()).toBe(200);
  const current = (await updated.json<{ question: { snapshot: { editToken: string } } }>()).question;
  expect(current).toMatchObject({ version: 2, snapshot: { name: '更新.musicxml' } });

  await env.DB.prepare('DELETE FROM score_attachments WHERE id = ?').bind(original.id).run();
  await cleanupScoreStorage(env);
  expect(new Uint8Array(await (await call(`${path}/score`)).arrayBuffer())).toEqual(replacement);
  expect(new Uint8Array(await (await call(`${path}/score?version=1`)).arrayBuffer())).toEqual(musicXml);
  const rename = { title: '依旧独立', first: 0, last: 0, expectedVersion: 2, reuseSnapshot: true, expectedEditToken: current.snapshot.editToken };
  const renamed = (await (await publish(rename)).json<{ question: { snapshot: { editToken: string } } }>()).question;
  expect(renamed).toMatchObject({ version: 2, title: '依旧独立', snapshot: { name: '更新.musicxml' } });
  expect(await (await publish(rename)).json()).toEqual({ question: renamed });
  expect((await publish({ ...rename, expectedEditToken: renamed.snapshot.editToken, title: fields.title })).status).toBe(200);
  expect((await publish(rename)).status).toBe(409);
  expect(await usage()).toBe(mainBytes.length + musicXml.length + replacement.length);
  expect((await env.DB.prepare('SELECT COUNT(*) AS count FROM sight_singing_score_snapshots').first())).toEqual({ count: 2 });
});

it('publishes a standalone MXL with bounded provenance, safe retries and a compatible legacy list', async () => {
  const files = zipSync({
    'META-INF/container.xml': new TextEncoder().encode('<container><rootfiles><rootfile full-path="score.xml"/></rootfiles></container>'),
    'score.xml': musicXml,
  });
  const listPath = `/api/choirs/${choirId}/sight-singing/questions`;
  const path = `${listPath}/${crypto.randomUUID()}`;
  await env.DB.prepare("UPDATE choirs SET plan = 'free', storage_limit_bytes = ? WHERE id = ?").bind(mainBytes.length + files.length - 1, choirId).run();
  const owner = (await env.DB.prepare('SELECT user_id FROM memberships WHERE id = ?').bind(memberId).first<{ user_id: string }>())!.user_id;
  const put = (name: string, bytes: Uint8Array) => {
    const body = new FormData();
    body.append('fields', JSON.stringify({ title: '独立片段', first: 0, last: 0, expectedVersion: null }));
    body.append('file', new Blob([bytes.slice()]), name);
    return call(path, { method: 'PUT', headers: { 'x-same-page-owner-user-id': owner, origin: 'https://same-page.test' }, body });
  };
  expect((await put('fake.pdf', files)).status).toBe(415);
  expect((await put('bad.xml', new TextEncoder().encode('<html/>'))).status).toBe(422);
  expect((await put('练习片段.mxl', files)).status).toBe(409);
  expect(await usage()).toBe(mainBytes.length);
  await env.DB.prepare('UPDATE choirs SET storage_limit_bytes = 52428800 WHERE id = ?').bind(choirId).run();
  const response = await put('练习片段.mxl', files);
  expect(response.status, await response.clone().text()).toBe(200);
  const published = { title: '独立片段', scoreId: null, attachmentId: null, revision: null, first: 0, last: 0, version: 1, snapshot: { name: '练习片段.mxl' } };
  expect(await response.json()).toMatchObject({ question: published });
  expect(await (await put('练习片段.mxl', files)).json()).toMatchObject({ question: published });
  expect(await (await call(listPath)).json()).toEqual({ questions: [] });
  expect(await (await call(listPath, { headers: { [SIGHT_SINGING_PROTOCOL_HEADER]: '2' } })).json()).toMatchObject({ questions: [published] });
  const copy = await call(`${path}/score`);
  expect(copy.headers.get('content-type')).toBe('application/vnd.recordare.musicxml');
  expect(copy.headers.get('cache-control')).toBe('no-store');
  expect(new Uint8Array(await copy.arrayBuffer())).toEqual(files);
  expect(await usage()).toBe(mainBytes.length + files.length);
  const snapshot = (await env.DB.prepare('SELECT object_key FROM sight_singing_score_snapshots WHERE choir_id = ?').bind(choirId).first<{ object_key: string }>())!;
  await env.DB.prepare('DELETE FROM choirs WHERE id = ?').bind(choirId).run();
  expect(await env.DB.prepare('SELECT platform_bytes FROM score_object_deletions WHERE object_key = ?').bind(snapshot.object_key).first()).toEqual({ platform_bytes: files.length });
  await cleanupScoreStorage(env);
  expect(await env.SCORES_BUCKET.head(snapshot.object_key)).toBeNull();
});

it("keeps MusicXML original bytes and negotiates legacy lists, counts and trash", async () => {
  const originalUsage = await usage();
  // A newly created drive supports MusicXML without any rollout configuration.
  expect(await (await call(`/api/choirs/${choirId}/attachments/capabilities`)).json()).toEqual({ musicxml: true });
  const uploaded = await upload('练习.musicxml', musicXml);
  expect(uploaded.response.status, await uploaded.response.clone().text()).toBe(201);
  expect(await (await list()).json()).toEqual({ attachments: [] });
  const headers = { 'X-Same-Page-Attachments': '2' };
  expect(await (await call(`/api/choirs/${choirId}/attachments?scoreIds=${scoreId}`, { headers })).json()).toMatchObject({attachments:[{kind:'musicxml',id:uploaded.id}]});
  expect(await (await call(`/api/choirs/${choirId}/bootstrap`)).json()).toMatchObject({scores:[{attachmentCount:0}]});
  expect(await (await call(`/api/choirs/${choirId}/bootstrap`, { headers })).json()).toMatchObject({scores:[{attachmentCount:1}]});
  expect(new Uint8Array(await (await call(`${base()}/${uploaded.id}/file`)).arrayBuffer())).toEqual(musicXml);
  expect(await usage()).toBe(originalUsage + musicXml.length);
  expect((await call(`${base()}/${uploaded.id}?expectedRevision=1`,{method:'DELETE'})).status).toBe(204);
  expect(await (await call(`/api/choirs/${choirId}/attachments/trash`)).json()).toEqual({attachments:[]});
  expect(await (await call(`/api/choirs/${choirId}/attachments/trash`,{headers})).json()).toMatchObject({attachments:[{kind:'musicxml'}]});
  expect((await call(`${base()}/${uploaded.id}/restore`,{method:'POST'})).status).toBe(204);
  expect(await usage()).toBe(originalUsage + musicXml.length);
});
it("rejects invalid MusicXML without publishing a file or leaking quota", async () => {
  const originalUsage=await usage();
  for (const bytes of ['<html/>','<score-partwise>','<score-timewise/>']) expect((await upload('bad.xml',bytes)).response.status).toBe(422);
  expect(await usage()).toBe(originalUsage);
  expect(await (await call(`/api/choirs/${choirId}/attachments?scoreIds=${scoreId}`,{headers:{'X-Same-Page-Attachments':'2'}})).json()).toEqual({attachments:[]});
});

it("reader sync preserves playable attachment counts with legacy protocol compatibility", async () => {
  const uploaded = await upload('practice.musicxml', musicXml);
  expect(uploaded.response.status).toBe(201);
  const path = `/api/choirs/${choirId}/scores/${scoreId}/sync?cursor=0&layerIds=%5B%5D`;
  expect(await (await call(path)).json()).toMatchObject({state:'active',score:{attachmentCount:0}});
  expect(await (await call(path,{headers:{'X-Same-Page-Attachments':'2'}})).json()).toMatchObject({state:'active',score:{attachmentCount:1}});
});

async function uploadGenerated(id = crypto.randomUUID(), revision?: number) {
  const query = new URLSearchParams({ name: "自动练习.musicxml", size: String(musicXml.length), source: "generated", ...(revision ? { expectedRevision: String(revision) } : {}) });
  const response = await call(`${base()}/${id}/file?${query}`, { method: revision ? "PUT" : "POST", headers: { "content-length": String(musicXml.length) }, body: musicXml });
  return { response, id };
}
it("projects practice availability independently of the legacy attachment directory count", async () => {
  const headers = { "X-Same-Page-Attachments": "2" };
  const paths = [`/api/choirs/${choirId}/bootstrap`, `/api/choirs/${choirId}/scores`, `/api/choirs/${choirId}/scores/${scoreId}/sync?cursor=0&layerIds=%5B%5D`];
  const assertSummary = async (expected: object) => {
    for (const path of paths) {
      const response = await call(path, { headers });
      expect(response.status).toBe(200);
      const body = await response.json() as { score?: object; scores?: object[] };
      expect(body.score ?? body.scores?.[0]).toMatchObject(expected);
    }
  };
  await assertSummary({ attachmentCount: 0, musicXmlCount: 0, hasGeneratedXml: false });
  const generated = await uploadGenerated();
  expect(generated.response.status).toBe(201);
  await assertSummary({ attachmentCount: 1, musicXmlCount: 1, hasGeneratedXml: true });
  expect(await (await call(paths[0])).json()).toMatchObject({ scores: [{ attachmentCount: 0, musicXmlCount: 0, hasGeneratedXml: false }] });
  const userXml = await upload("校订.musicxml", musicXml);
  expect(userXml.response.status).toBe(201);
  expect((await upload("排练.wav", wav)).response.status).toBe(201);
  await assertSummary({ attachmentCount: 3, musicXmlCount: 2, hasGeneratedXml: true });
  expect((await call(`${base()}/${generated.id}?expectedRevision=1`, { method: "DELETE" })).status).toBe(204);
  await assertSummary({ attachmentCount: 2, musicXmlCount: 1, hasGeneratedXml: false });
  expect((await call(`${base()}/${userXml.id}?expectedRevision=1`, { method: "DELETE" })).status).toBe(204);
  await assertSummary({ attachmentCount: 1, musicXmlCount: 0, hasGeneratedXml: false });
  expect((await call(`${base()}/${generated.id}/restore`, { method: "POST" })).status).toBe(204);
  await assertSummary({ attachmentCount: 2, musicXmlCount: 1, hasGeneratedXml: true });
});
it("keeps one generated XML slot separate from user uploads and allows owner updates", async () => {
  const userXml = await upload("用户校订.musicxml", musicXml);
  expect(userXml.response.status).toBe(201);
  const generated = await uploadGenerated();
  expect(generated.response.status, await generated.response.clone().text()).toBe(201);
  expect(await generated.response.json()).toMatchObject({ attachment: { source: "generated", revision: 1 } });
  expect((await uploadGenerated()).response.status).toBe(409);
  expect((await uploadGenerated(userXml.id, 1)).response.status).toBe(409);
  expect((await uploadGenerated(generated.id, 1)).response.status).toBe(200);
  expect((await uploadGenerated(generated.id, 1)).response.status).toBe(409);
  expect(await usage()).toBe(mainBytes.length + musicXml.length * 2);
  const headers = { "X-Same-Page-Attachments": "2" };
  expect(await (await call(`/api/choirs/${choirId}/attachments?scoreIds=${scoreId}`, { headers })).json()).toMatchObject({ attachments: [
    { id: userXml.id, source: "user" }, { id: generated.id, source: "generated", revision: 2 },
  ] });
  expect((await call(`${base()}/${generated.id}`, { method: "DELETE" })).status).toBe(400);
  expect((await call(`${base()}/${generated.id}?expectedRevision=2`, { method: "DELETE" })).status).toBe(204);
  // Removing the generated result is remembered after its old bytes expire.
  await env.DB.prepare("UPDATE score_attachments SET trash_expires_at = ? WHERE id = ?").bind(Date.now() - 1, generated.id).run();
  await cleanupScoreStorage(env);
  expect((await uploadGenerated()).response.status).toBe(409);
});
it.each([true, false])("atomically replaces PDF with keepGeneratedXml=%s without touching user XML", async keepGeneratedXml => {
  const userXml = await upload("用户校订.musicxml", musicXml);
  const generated = await uploadGenerated();
  expect(generated.response.status).toBe(201);
  const next = crypto.randomUUID();
  const stored = await env.SCORES_BUCKET.put(next, mainBytes);
  await env.DB.batch([
    env.DB.prepare("UPDATE choirs SET storage_used_bytes = storage_used_bytes + ? WHERE id = ?").bind(mainBytes.length, choirId),
    env.DB.prepare(`INSERT INTO score_versions (id, choir_id, score_id, version_number, object_key, size_bytes, sha256, etag, page_count, state, candidate_expires_at, base_revision)
      VALUES (?, ?, ?, 2, ?, ?, 'next', ?, 1, 'ready', ?, 1)`).bind(next, choirId, scoreId, next, mainBytes.length, stored!.httpEtag, Date.now() + 86400000),
  ]);
  const path = `/api/choirs/${choirId}/scores/${scoreId}`;
  const publish = (revision: number) => call(`${path}/versions/${next}/publish`, { method: "POST", ...json({ expectedRevision: revision, keepGeneratedXml }) });
  expect((await publish(3)).status).toBe(409);
  expect(await (await call(`${path}/versions`)).json()).toMatchObject({ hasGeneratedXml: true, canTrashFiles: true });
  expect((await publish(1)).status).toBe(204);
  expect((await publish(1)).status).toBe(204);
  expect((await call(`${base()}/${userXml.id}/file`)).status).toBe(200);
  expect((await call(`${base()}/${generated.id}/file`)).status).toBe(keepGeneratedXml ? 200 : 404);
  if (!keepGeneratedXml) {
    expect((await uploadGenerated(generated.id, 1)).response.status).toBe(409);
    expect((await call(`${base()}/${generated.id}/restore`, { method: "POST" })).status).toBe(204);
    expect((await uploadGenerated(generated.id, 3)).response.status).toBe(200);
  }
});
it("does not let a non-owner label or replace a file as generated", async () => {
  const generated = await uploadGenerated();
  expect(generated.response.status).toBe(201);
  // Retain the session but revoke ownership: ordinary upload/modify grants are insufficient.
  const owner = await env.DB.prepare("SELECT user_id FROM memberships WHERE id = ?").bind(memberId).first<{ user_id: string }>();
  const other = crypto.randomUUID(), now = Date.now();
  await env.DB.prepare("INSERT INTO user (id,name,email,email_verified,created_at,updated_at) VALUES (?,'new owner','other@example.test',1,?,?)").bind(other, now, now).run();
  const membership = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO memberships (id,choir_id,user_id,display_name,status) VALUES (?,?,?,'new owner','active')").bind(membership, choirId, other).run();
  await env.DB.prepare("UPDATE choirs SET owner_membership_id = ? WHERE id = ?").bind(membership, choirId).run();
  await env.DB.prepare(`UPDATE memberships SET permissions = '{"operations":["uploadFiles","modifyFiles"],"sharedLayers":[]}' WHERE user_id = ?`).bind(owner!.user_id).run();
  expect((await uploadGenerated()).response.status).toBe(403);
  expect((await uploadGenerated(generated.id, 1)).response.status).toBe(403);
});
