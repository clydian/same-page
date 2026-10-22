import { hashPassword } from "better-auth/crypto";
import { env } from "cloudflare:workers";
import {
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { beforeEach, it, expect, vi } from "vitest";
import worker from "./index";
import { provisionChoir } from "./choirs/provision";
import { cleanupAdminXml } from "./admin/cleanup";
import { cleanupScoreStorage } from "./scores/cleanup";
import type { CliTokenCredential } from "../src/shared/cli-tokens";
import { hashCliToken } from "./admin/cli-access";
const password = "admin-workbench-password",
  hash = await hashPassword(password);
const xml = new TextEncoder().encode(
  '<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Soprano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure></part></score-partwise>',
);
let operatorId: string,
  ownerId: string,
  cookie = "",
  ownerCookie = "",
  scoreId: string,
  choirId: string,
  versionId: string,
  otherScore: string;
const json = (data: unknown) => ({
  headers: { "content-type": "application/json" },
  body: JSON.stringify(data),
});
async function call(path: string, init: RequestInit = {}) {
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new Request(`https://same-page.test${path}`, {
      ...init,
      headers: { cookie, origin: "https://same-page.test", ...init.headers },
    }),
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return new Response(response.body ? await response.arrayBuffer() : null, {
    status: response.status,
    headers: response.headers,
  });
}
async function user(email: string) {
  const id = crypto.randomUUID(),
    now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES(?,?,?,1,?,?)",
    ).bind(id, "测试", email, now, now),
    env.DB.prepare(
      "INSERT INTO account(id,account_id,provider_id,user_id,password,created_at,updated_at) VALUES(?,?,'credential',?,?,?,?)",
    ).bind(crypto.randomUUID(), id, id, hash, now, now),
  ]);
  return id;
}
async function seedScore(drive: string, name: string) {
  const id = crypto.randomUUID(),
    v = crypto.randomUUID(),
    key = crypto.randomUUID(),
    pdf = new TextEncoder().encode("%PDF-1.4 fixture");
  const file = await env.SCORES_BUCKET.put(key, pdf);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO scores(id,choir_id,file_name,file_name_key,current_version_id) VALUES(?,?,?,?,?)",
    ).bind(id, drive, name, name, v),
    env.DB.prepare(
      "INSERT INTO score_versions(id,score_id,choir_id,version_number,object_key,size_bytes,sha256,etag,page_count,state) VALUES(?,?,?,1,?,?,'source-sha',?,1,'ready')",
    ).bind(v, id, drive, key, pdf.length, file!.httpEtag),
  ]);
  return { id, v };
}
async function login(email: string) {
  const r = await call("/api/auth/sign-in/email", {
    method: "POST",
    ...json({ email, password }),
  });
  expect(r.status, await r.clone().text()).toBe(200);
  return r.headers.get("set-cookie")!.split(";")[0];
}
const base = () => `/api/admin/scores/${scoreId}`;
async function upload(
  bytes = xml,
  id = crypto.randomUUID(),
  source = versionId,
  init: RequestInit = {},
  targetScore = scoreId,
) {
  const sha = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (v) => v.toString(16).padStart(2, "0"),
  ).join("");
  return {
    id,
    response: await call(
      `/api/admin/scores/${targetScore}/candidates/${id}?${new URLSearchParams({ name: "练习.musicxml", size: String(bytes.length), sha256: sha, sourceVersionId: source })}`,
      { ...init, method: "POST", body: bytes },
    ),
  };
}
async function approve(id: string, revision = 0) {
  return call(`${base()}/candidates/${id}/review`, {
    method: "POST",
    ...json({
      expectedRevision: revision,
      decision: "approved",
      technicalPassed: true,
      note: "关键片段已核对",
    }),
  });
}
function publication(
  review = 1,
  revision = 0,
  attachmentId = crypto.randomUUID(),
) {
  return {
    id: crypto.randomUUID(),
    expectedReviewRevision: review,
    expectedAttachmentRevision: revision,
    attachmentId,
  };
}
async function publish(id: string, body = publication()) {
  return call(`${base()}/candidates/${id}/publish`, {
    method: "POST",
    ...json(body),
  });
}
beforeEach(async () => {
  vi.restoreAllMocks();
  cookie = "";
  await env.DB.batch(
    [
      "DELETE FROM choirs",
      "DELETE FROM product_operators",
      "DELETE FROM xml_publications",
      "DELETE FROM xml_publish_staging",
      "DELETE FROM product_admin_audit",
      "DELETE FROM session",
      "DELETE FROM account",
      "DELETE FROM user",
      "DELETE FROM score_object_deletions",
      "DELETE FROM rate_limits",
    ].map((s) => env.DB.prepare(s)),
  );
  await env.DB.prepare(
    "UPDATE product_admin_limits SET storage_limit_bytes=1073741824",
  ).run();
  ownerId = await user("owner-admin@example.test");
  operatorId = await user("operator@example.test");
  const drive = await provisionChoir({
    binding: env.DB,
    ownerUserId: ownerId,
    ownerDisplayName: "拥有者",
    inviteSecret: env.INVITE_SECRET,
  });
  choirId = drive.choirId;
  const other = await provisionChoir({
    binding: env.DB,
    ownerUserId: ownerId,
    ownerDisplayName: "拥有者",
    inviteSecret: env.INVITE_SECRET,
  });
  const s = await seedScore(choirId, "甲谱.pdf");
  scoreId = s.id;
  versionId = s.v;
  otherScore = (await seedScore(other.choirId, "乙谱.pdf")).id;
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO product_operators(user_id,publish_xml) VALUES(?,1)",
    ).bind(operatorId),
    env.DB.prepare("INSERT INTO product_admin_drives(choir_id) VALUES(?)").bind(
      choirId,
    ),
    env.DB.prepare("INSERT INTO product_admin_drives(choir_id) VALUES(?)").bind(
      other.choirId,
    ),
  ]);
  ownerCookie = await login("owner-admin@example.test");
  cookie = await login("operator@example.test");
});
it("requires independent operational grants, scopes pilots, and leaves membership/activity untouched", async () => {
  expect(
    (await call("/api/admin/scores", { headers: { cookie: "" } })).status,
  ).toBe(403);
  expect(
    (await call("/api/admin/scores", { headers: { cookie: ownerCookie } }))
      .status,
  ).toBe(403);
  expect((await call(`/api/choirs/${choirId}/scores`)).status).toBe(403);
  const list = await call("/api/admin/scores");
  expect(list.status, await list.clone().text()).toBe(200);
  expect(((await list.json()) as { scores: unknown[] }).scores).toHaveLength(2);
  expect(
    await env.DB.prepare("SELECT count(*) n FROM memberships WHERE user_id=?")
      .bind(operatorId)
      .first(),
  ).toEqual({ n: 0 });
  expect((await call(base() + "/pdf")).status).toBe(200);
  await env.DB.prepare("DELETE FROM product_admin_drives WHERE choir_id=?")
    .bind(choirId)
    .run();
  expect((await call(base())).status).toBe(404);
  expect((await call(base() + "/pdf")).status).toBe(404);
  await env.DB.prepare("DELETE FROM product_operators WHERE user_id=?")
    .bind(operatorId)
    .run();
  expect((await call("/api/admin/session")).status).toBe(403);
});
it("isolates imported candidates and publishes idempotently into the existing generated slot without membership", async () => {
  const before = await env.DB.prepare(
    "SELECT storage_used_bytes FROM choirs WHERE id=?",
  )
    .bind(choirId)
    .first();
  const imported = await upload();
  expect(imported.response.status, await imported.response.clone().text()).toBe(
    201,
  );
  expect((await upload(xml, imported.id)).response.status).toBe(200);
  expect(
    await env.DB.prepare("SELECT storage_used_bytes FROM choirs WHERE id=?")
      .bind(choirId)
      .first(),
  ).toEqual(before);
  expect(
    (
      await call(`${base()}/candidates/${imported.id}/file`, {
        headers: { cookie: ownerCookie },
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await call(
        `/api/admin/scores/${otherScore}/candidates/${imported.id}/file`,
      )
    ).status,
  ).toBe(404);
  expect(
    await env.DB.prepare("SELECT count(*) n FROM score_attachments").first(),
  ).toEqual({ n: 0 });
  expect((await publish(imported.id)).status).toBe(409);
  expect((await approve(imported.id)).status).toBe(204);
  const p = publication();
  const r = await publish(imported.id, p);
  expect(r.status, await r.clone().text()).toBe(204);
  expect((await publish(imported.id, p)).status).toBe(204);
  const slot = await env.DB.prepare(
    "SELECT source,revision,source_pdf_version_id FROM score_attachments WHERE id=?",
  )
    .bind(p.attachmentId)
    .first();
  expect(slot).toEqual({
    source: "generated",
    revision: 1,
    source_pdf_version_id: versionId,
  });
  expect(
    (
      await call(
        `/api/choirs/${choirId}/scores/${scoreId}/attachments/${p.attachmentId}/file?revision=1`,
        { headers: { cookie: ownerCookie } },
      )
    ).status,
  ).toBe(200);
  expect((await call(`${base()}/candidates/${imported.id}/file`)).status).toBe(
    200,
  );
  expect(
    await env.DB.prepare("SELECT count(*) n FROM xml_publications").first(),
  ).toEqual({ n: 1 });
});
it("rejects invalid XML, mismatched origins and old PDF imports, and cleans expired candidates separately", async () => {
  const invalid = await upload(new TextEncoder().encode("not xml"));
  expect(invalid.response.status).toBe(422);
  expect(
    (
      await call(base() + "/candidates/" + crypto.randomUUID(), {
        method: "POST",
        headers: { origin: "https://evil.test" },
      })
    ).status,
  ).toBe(403);
  expect(
    (await upload(xml, crypto.randomUUID(), crypto.randomUUID())).response
      .status,
  ).toBe(409);
  const good = await upload();
  expect(good.response.status).toBe(201);
  await env.DB.prepare("UPDATE xml_candidates SET expires_at=?")
    .bind(Date.now() - 1)
    .run();
  expect((await call(`${base()}/candidates/${good.id}/file`)).status).toBe(404);
  await cleanupAdminXml(env);
  await cleanupScoreStorage(env);
  expect(
    await env.DB.prepare("SELECT count(*) n FROM xml_candidates").first(),
  ).toEqual({ n: 0 });
});
it("serializes competing publications and preserves history across formal attachment replacement", async () => {
  const first = await upload();
  await approve(first.id);
  const p = publication();
  expect((await publish(first.id, p)).status).toBe(204);
  const second = await upload();
  await approve(second.id);
  const third = await upload();
  await approve(third.id);
  const responses = await Promise.all([
    publish(second.id, publication(1, 1, p.attachmentId)),
    publish(third.id, publication(1, 1, p.attachmentId)),
  ]);
  expect(responses.map((r) => r.status).sort()).toEqual([204, 409]);
  expect((await call(`${base()}/candidates/${first.id}/file`)).status).toBe(
    200,
  );
  expect(
    await env.DB.prepare("SELECT revision FROM score_attachments WHERE id=?")
      .bind(p.attachmentId)
      .first(),
  ).toEqual({ revision: 2 });
  expect(
    await env.DB.prepare("SELECT count(*) n FROM xml_publish_staging").first(),
  ).toEqual({ n: 0 });
});
it.each(["pdf", "removed", "trashed", "purged", "revoked", "review", "quota"])(
  "blocks stale publication after %s without altering the formal slot",
  async (change) => {
    const imported = await upload();
    await approve(imported.id);
    let expected = 409;
    if (change === "pdf") {
      const next = crypto.randomUUID();
      await env.DB.prepare(
        "INSERT INTO score_versions(id,score_id,choir_id,version_number,object_key,size_bytes,sha256,etag,page_count,state) SELECT ?,score_id,choir_id,2,?,size_bytes,sha256,etag,page_count,state FROM score_versions WHERE id=?",
      )
        .bind(next, crypto.randomUUID(), versionId)
        .run();
      await env.DB.prepare("UPDATE scores SET current_version_id=? WHERE id=?")
        .bind(next, scoreId)
        .run();
    }
    if (change === "removed")
      await env.DB.prepare(
        "UPDATE scores SET generated_xml_disabled=1 WHERE id=?",
      )
        .bind(scoreId)
        .run();
    if (change === "trashed") {
      await env.DB.prepare(
        "UPDATE scores SET trashed_at=?,trash_expires_at=? WHERE id=?",
      )
        .bind(Date.now(), Date.now() + 100000, scoreId)
        .run();
      expected = 404;
    }
    if (change === "purged") {
      await env.DB.prepare("UPDATE choirs SET purged_at=? WHERE id=?")
        .bind(Date.now(), choirId)
        .run();
      expected = 404;
    }
    if (change === "revoked") {
      await env.DB.prepare("DELETE FROM product_operators WHERE user_id=?")
        .bind(operatorId)
        .run();
      expected = 403;
    }
    if (change === "review") await approve(imported.id, 1);
    if (change === "quota")
      await env.DB.prepare("UPDATE choirs SET storage_limit_bytes=1 WHERE id=?")
        .bind(choirId)
        .run();
    expect((await publish(imported.id)).status).toBe(expected);
    expect(
      await env.DB.prepare("SELECT count(*) n FROM score_attachments").first(),
    ).toEqual({ n: 0 });
  },
);
it("enforces candidate budget and review capability, blocks unverified approval", async () => {
  await env.DB.prepare(
    "UPDATE product_admin_limits SET storage_limit_bytes=1",
  ).run();
  expect((await upload()).response.status).toBe(409);
  await env.DB.prepare(
    "UPDATE product_admin_limits SET storage_limit_bytes=1073741824",
  ).run();
  const r = await upload();
  expect(
    (
      await call(`${base()}/candidates/${r.id}/review`, {
        method: "POST",
        ...json({
          expectedRevision: 0,
          decision: "approved",
          technicalPassed: false,
          note: "",
        }),
      })
    ).status,
  ).toBe(400);
  await env.DB.prepare(
    "UPDATE product_operators SET review_xml=0 WHERE user_id=?",
  )
    .bind(operatorId)
    .run();
  expect((await approve(r.id)).status).toBe(403);
});

it("rechecks authority after copying bytes and leaves no visible file on revoked publication", async () => {
  const r = await upload();
  await approve(r.id);
  const put = env.SCORES_BUCKET.put.bind(env.SCORES_BUCKET);
  vi.spyOn(env.SCORES_BUCKET, "put").mockImplementationOnce(async (...args) => {
    const stored = await put(...args);
    await env.DB.prepare("DELETE FROM product_operators WHERE user_id=?")
      .bind(operatorId)
      .run();
    return stored;
  });
  const response = await publish(r.id);
  expect(response.status, await response.clone().text()).toBe(403);
  expect(
    await env.DB.prepare("SELECT count(*) n FROM score_attachments").first(),
  ).toEqual({ n: 0 });
  expect(
    await env.DB.prepare("SELECT count(*) n FROM xml_publish_staging").first(),
  ).toEqual({ n: 0 });
});
it("deduplicates concurrent retries of exactly the same publication", async () => {
  const r = await upload();
  await approve(r.id);
  const p = publication();
  const responses = await Promise.all([publish(r.id, p), publish(r.id, p)]);
  expect(responses.map((r) => r.status)).toEqual([204, 204]);
  expect(
    await env.DB.prepare("SELECT count(*) n FROM xml_publications").first(),
  ).toEqual({ n: 1 });
  expect(
    await env.DB.prepare(
      "SELECT count(*) n FROM product_admin_audit WHERE action='publish'",
    ).first(),
  ).toEqual({ n: 1 });
});
it("reclaims an expired candidate without deleting its independently published attachment", async () => {
  const r = await upload();
  await approve(r.id);
  const p = publication();
  await publish(r.id, p);
  await env.DB.prepare("UPDATE xml_candidates SET expires_at=? WHERE id=?")
    .bind(Date.now() - 1, r.id)
    .run();
  await cleanupAdminXml(env);
  await cleanupScoreStorage(env);
  expect(
    (
      await call(
        `/api/choirs/${choirId}/scores/${scoreId}/attachments/${p.attachmentId}/file`,
        { headers: { cookie: ownerCookie } },
      )
    ).status,
  ).toBe(200);
});
it("rejects a late import commit if the source changes during R2 write", async () => {
  const put = env.SCORES_BUCKET.put.bind(env.SCORES_BUCKET);
  vi.spyOn(env.SCORES_BUCKET, "put").mockImplementationOnce(async (...args) => {
    const stored = await put(...args);
    await env.DB.prepare(
      "UPDATE scores SET generated_xml_disabled=1 WHERE id=?",
    )
      .bind(scoreId)
      .run();
    return stored;
  });
  const r = await upload();
  expect(r.response.status).toBe(409);
  expect(
    await env.DB.prepare("SELECT state FROM xml_candidates WHERE id=?")
      .bind(r.id)
      .first(),
  ).toEqual({ state: "failed" });
  expect((await call(`${base()}/candidates/${r.id}/file`)).status).toBe(409);
});


it("refreshes a selected candidate outside the first history page without exposing another score", async () => {
  const old = await upload();
  expect(old.response.status).toBe(201);
  const now = Date.now();
  await env.DB.batch(Array.from({ length: 101 }, (_, index) => {
    const id = crypto.randomUUID();
    return env.DB.prepare(`INSERT INTO xml_candidates(id,choir_id,score_id,source_version_id,source_sha256,name,size_bytes,sha256,object_key,state,tool,parameters,imported_by,created_at,expires_at)
      SELECT ?,choir_id,score_id,source_version_id,source_sha256,name,size_bytes,sha256,?,'failed',tool,parameters,imported_by,?,expires_at FROM xml_candidates WHERE id=?`)
      .bind(id, `history/${id}`, now + index + 1, old.id);
  }));
  const first = await (await call(base())).json<{ candidates: { id: string }[]; nextBefore: string; selectedCandidate: { id: string } | null }>();
  expect(first.candidates).toHaveLength(100);
  expect(first.candidates.some((v) => v.id === old.id)).toBe(false);
  const selected = await (await call(`${base()}?selected=${old.id}`)).json<{ selectedCandidate: { id: string } }>();
  expect(selected.selectedCandidate.id).toBe(old.id);
  const outside = await (await call(`/api/admin/scores/${otherScore}?selected=${old.id}`)).json<{ selectedCandidate: unknown }>();
  expect(outside.selectedCandidate).toBeNull();
});

async function createToken(overrides: Record<string, unknown> = {}) {
  const response = await call("/api/admin/cli-tokens", {
    method: "POST",
    ...json({ name: "本机识谱", driveIds: [choirId], ...overrides }),
  });
  expect(response.status, await response.clone().text()).toBe(201);
  return response.json<{ token: string; credential: CliTokenCredential }>();
}
const bearer = (token: string): RequestInit => ({ headers: { authorization: `Bearer ${token}` } });

it("creates bounded CLI credentials, stores only their hash, and requires cookie plus same-origin management", async () => {
  const created = await createToken();
  expect(created.token).toMatch(/^sp_cli_[a-f0-9]{64}$/);
  expect(created.credential).toMatchObject({ name: "本机识谱", canUpload: false, driveIds: [choirId], revokedAt: null, lastUsedAt: null });
  expect(created.credential.expiresAt - created.credential.createdAt).toBe(7 * 86400000);
  const stored = await env.DB.prepare("SELECT * FROM admin_cli_tokens WHERE id=?").bind(created.credential.id).first();
  expect(stored?.token_hash).toBe(await hashCliToken(created.token));
  expect(JSON.stringify(stored)).not.toContain(created.token);
  const list = await (await call("/api/admin/cli-tokens")).json<{ tokens: CliTokenCredential[] }>();
  expect(list.tokens).toEqual([created.credential]);
  expect(JSON.stringify(list)).not.toContain("token_hash");
  const blockedHeaders: HeadersInit[] = [{ cookie: "" }, { authorization: `Bearer ${created.token}` }];
  for (const headers of blockedHeaders) {
    expect((await call("/api/admin/cli-tokens", { headers })).status).toBe(403);
  }
  for (const origin of ["", "https://untrusted.test"]) {
    expect((await call("/api/admin/cli-tokens", { method: "POST", ...json({ name: "CSRF", driveIds: [choirId] }), headers: { origin, "content-type": "application/json" } })).status).toBe(403);
    expect((await call(`/api/admin/cli-tokens/${created.credential.id}`, { method: "DELETE", headers: { origin } })).status).toBe(403);
  }
  expect((await call("/api/admin/cli-tokens", { method: "POST", ...json({ name: "无cookie", driveIds: [choirId] }), headers: { cookie: "", "content-type": "application/json" } })).status).toBe(403);
});

it("rejects unbounded or unavailable CLI scopes and enforces the current operator upload grant", async () => {
  for (const data of [{ driveIds: [] }, { name: " " }, { expiresInDays: 0 }, { expiresInDays: 31 }]) {
    expect((await call("/api/admin/cli-tokens", { method: "POST", ...json({ name: "校验", driveIds: [choirId], ...data }) })).status).toBe(400);
  }
  expect((await call("/api/admin/cli-tokens", { method: "POST", ...json({ name: "未知盘", driveIds: [crypto.randomUUID()] }) })).status).toBe(403);
  await env.DB.prepare("UPDATE product_operators SET review_xml=0 WHERE user_id=?").bind(operatorId).run();
  expect((await createToken()).credential.canUpload).toBe(false);
  expect((await call("/api/admin/cli-tokens", { method: "POST", ...json({ name: "越权", driveIds: [choirId], canUpload: true }) })).status).toBe(403);
});

it("limits every CLI directory, score and file read to its explicit drives without changing browser access", async () => {
  const other = await env.DB.prepare("SELECT choir_id,current_version_id FROM scores WHERE id=?").bind(otherScore).first<{ choir_id: string; current_version_id: string }>();
  const inScope = await upload();
  const outside = await upload(xml, crypto.randomUUID(), other!.current_version_id, {}, otherScore);
  await approve(inScope.id);
  const publicationData = publication();
  expect((await publish(inScope.id, publicationData)).status).toBe(204);
  const created = await createToken();
  const auth = bearer(created.token);
  const drives = await (await call("/api/admin/drives", auth)).json<{ drives: { id: string }[] }>();
  expect(drives.drives.map((d) => d.id)).toEqual([choirId]);
  const scores = await (await call("/api/admin/scores", auth)).json<{ scores: { id: string }[] }>();
  expect(scores.scores.map((s) => s.id)).toEqual([scoreId]);
  const filtered = await (await call(`/api/admin/scores?drive=${other!.choir_id}`, auth)).json<{ scores: unknown[] }>();
  expect(filtered.scores).toEqual([]);
  for (const path of [base(), `${base()}/pdf`, `${base()}/candidates/${inScope.id}/file`, `${base()}/published?revision=1`]) {
    expect((await call(path, auth)).status).toBe(200);
  }
  expect((await call(`${base()}/pdf`, { headers: { cookie: "", authorization: `Bearer ${created.token}` } })).status).toBe(200);
  for (const suffix of ["", "/pdf", `/candidates/${outside.id}/file`, "/published?revision=1"]) {
    expect((await call(`/api/admin/scores/${otherScore}${suffix}`, auth)).status).toBe(404);
  }
  const detail = await (await call(`${base()}?selected=${outside.id}`, auth)).json<{ selectedCandidate: unknown }>();
  expect(detail.selectedCandidate).toBeNull();
  const browserScores = await (await call("/api/admin/scores")).json<{ scores: unknown[] }>();
  expect(browserScores.scores).toHaveLength(2);
  expect((await call("/api/admin/cli-tokens", auth)).status).toBe(403);
  const uploader = await createToken({ canUpload: true });
  expect((await upload(xml, crypto.randomUUID(), other!.current_version_id, bearer(uploader.token), otherScore)).response.status).toBe(404);
});

it("keeps readonly CLI tokens from upload and every CLI token from review, publication or unrelated APIs", async () => {
  const readonly = await createToken();
  expect((await upload(xml, crypto.randomUUID(), versionId, bearer(readonly.token))).response.status).toBe(403);
  const created = await createToken({ canUpload: true });
  const imported = await upload(xml, crypto.randomUUID(), versionId, { headers: { cookie: "", authorization: `Bearer ${created.token}` } });
  expect(imported.response.status, await imported.response.clone().text()).toBe(201);
  for (const [path, method] of [
    [`${base()}/candidates/${imported.id}/review`, "POST"],
    [`${base()}/candidates/${imported.id}/publish`, "POST"],
    ["/api/admin/audit", "GET"], ["/api/admin/session", "GET"],
    ["/api/admin/reports", "GET"], ["/api/auth/get-session", "GET"],
    ["/api/user/lifecycle", "GET"], [`/api/choirs/${choirId}/scores`, "GET"],
    ["/api/admin/cli-tokens", "GET"], ["/api/admin/cli-tokens", "POST"],
    [`/api/admin/cli-tokens/${created.credential.id}`, "DELETE"],
  ]) expect((await call(path, { ...bearer(created.token), method })).status).toBe(403);
  expect((await approve(imported.id)).status).toBe(204);
  expect((await publish(imported.id)).status).toBe(204);
  expect((await call(base(), bearer("invalid-token"))).status).toBe(403);
  expect((await call(base(), { headers: { authorization: "" } })).status).toBe(403);
  expect((await upload(xml, crypto.randomUUID(), crypto.randomUUID(), bearer(created.token))).response.status).toBe(409);
});

it.each(["revoked", "expired", "operator", "pilot", "deleted"])("rejects CLI access after %s without falling back to the browser cookie", async (reason) => {
  const created = await createToken({ canUpload: true });
  if (reason === "revoked") {
    expect((await call(`/api/admin/cli-tokens/${created.credential.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await call(`/api/admin/cli-tokens/${created.credential.id}`, { method: "DELETE" })).status).toBe(204);
    const listed = await (await call("/api/admin/cli-tokens")).json<{ tokens: CliTokenCredential[] }>();
    expect(listed.tokens[0].revokedAt).toBeTypeOf("number");
  }
  if (reason === "expired") await env.DB.prepare("UPDATE admin_cli_tokens SET expires_at=? WHERE id=?").bind(Date.now() - 1, created.credential.id).run();
  if (reason === "operator") await env.DB.prepare("UPDATE product_operators SET view_scores=0 WHERE user_id=?").bind(operatorId).run();
  if (reason === "pilot") await env.DB.prepare("DELETE FROM product_admin_drives WHERE choir_id=?").bind(choirId).run();
  if (reason === "deleted") await env.DB.prepare("INSERT INTO user_lifecycle(user_id,deletion_id,auth_method,deleted_at,expires_at) VALUES(?,?,'credential',?,?)").bind(operatorId, crypto.randomUUID(), Date.now(), Date.now() + 86400000).run();
  expect((await call(base(), bearer(created.token))).status).toBe(reason === "pilot" ? 404 : 403);
  expect((await upload(xml, crypto.randomUUID(), versionId, bearer(created.token))).response.status).toBe(reason === "pilot" ? 404 : 403);
});

it("keeps revoked tokens private to their creator and denies upload after review permission is withdrawn", async () => {
  const created = await createToken({ canUpload: true });
  await env.DB.prepare("INSERT INTO product_operators(user_id) VALUES(?)").bind(ownerId).run();
  const otherList = await (await call("/api/admin/cli-tokens", { headers: { cookie: ownerCookie } })).json<{ tokens: unknown[] }>();
  expect(otherList.tokens).toEqual([]);
  expect((await call(`/api/admin/cli-tokens/${created.credential.id}`, { method: "DELETE", headers: { cookie: ownerCookie } })).status).toBe(204);
  expect((await call(base(), bearer(created.token))).status).toBe(200);
  const listed = await (await call("/api/admin/cli-tokens")).json<{ tokens: CliTokenCredential[] }>();
  expect(listed.tokens[0].lastUsedAt).toBeTypeOf("number");
  await env.DB.prepare("UPDATE product_operators SET review_xml=0 WHERE user_id=?").bind(operatorId).run();
  expect((await call(base(), bearer(created.token))).status).toBe(200);
  expect((await upload(xml, crypto.randomUUID(), versionId, bearer(created.token))).response.status).toBe(403);
});

it.each(["revoke", "pilot", "operator", "source"])("rechecks CLI upload authority when %s changes during the R2 write", async (change) => {
  const created = await createToken({ canUpload: true });
  const put = env.SCORES_BUCKET.put.bind(env.SCORES_BUCKET);
  vi.spyOn(env.SCORES_BUCKET, "put").mockImplementationOnce(async (...args) => {
    const stored = await put(...args);
    if (change === "revoke") await env.DB.prepare("UPDATE admin_cli_tokens SET revoked_at=? WHERE id=?").bind(Date.now(), created.credential.id).run();
    if (change === "pilot") await env.DB.prepare("DELETE FROM product_admin_drives WHERE choir_id=?").bind(choirId).run();
    if (change === "operator") await env.DB.prepare("UPDATE product_operators SET review_xml=0 WHERE user_id=?").bind(operatorId).run();
    if (change === "source") {
      const next = crypto.randomUUID();
      await env.DB.prepare("INSERT INTO score_versions(id,score_id,choir_id,version_number,object_key,size_bytes,sha256,etag,page_count,state) SELECT ?,score_id,choir_id,2,?,size_bytes,sha256,etag,page_count,state FROM score_versions WHERE id=?")
        .bind(next, crypto.randomUUID(), versionId).run();
      await env.DB.prepare("UPDATE scores SET current_version_id=? WHERE id=?").bind(next, scoreId).run();
    }
    return stored;
  });
  const result = await upload(xml, crypto.randomUUID(), versionId, bearer(created.token));
  expect(result.response.status).toBe(409);
  expect(await env.DB.prepare("SELECT state FROM xml_candidates WHERE id=?").bind(result.id).first()).toEqual({ state: "failed" });
  expect(await env.DB.prepare("SELECT count(*) n FROM score_object_deletions").first()).toEqual({ n: 1 });
  expect(await env.DB.prepare("SELECT count(*) n FROM score_attachments").first()).toEqual({ n: 0 });
});
