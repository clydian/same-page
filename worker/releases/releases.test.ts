import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { hashPassword } from "better-auth/crypto";
import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import worker from "../index";
import { releaseContract } from "../../src/shared/release-channels";
import { extendedVerification, releaseVersion } from "./catalog";
const A = "a".repeat(40), B = "b".repeat(40), C = "c".repeat(40);
const digest = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))), b => b.toString(16).padStart(2, "0")).join("");
const call = async (path: string, init?: RequestInit) => {
  const context = createExecutionContext();
  const response = await worker.fetch(new Request(`https://same-page.test${path}`, init), { ...env, RELEASE_CHANNELS_ENABLED: "true" }, context);
  await waitOnExecutionContext(context); return response;
};
async function release(id: string, ready = 1, identity: { buildId: string; version?: string } | null = { buildId: id, version: id === A ? "v26.10.22.1200" : "v26.10.22.1530" }) {
  const html = `<meta name="same-page-build-id" content="${id}">`;
  const files: Record<string, { sha256: string; bytes: number; contentType: string }> = { "index.html": { sha256: await digest(html), bytes: html.length, contentType: "text/html" }, "app.js": { sha256: await digest(id), bytes: id.length, contentType: "text/javascript" }, "sw.js": { sha256: await digest(id), bytes: id.length, contentType: "text/javascript" } };
  const build = identity ? JSON.stringify(identity) : null;
  if (build) files["build.json"] = { sha256: await digest(build), bytes: build.length, contentType: "application/json" };
  const sealed = JSON.stringify({ probeDigest: "0".repeat(64), storageDigest: "0".repeat(64), buildId: id, contract: releaseContract, files });
  for (const [name,entry] of Object.entries(files)) await env.FRONTEND_RELEASES!.put(`releases/${id}/${name}`, name === "index.html" ? html : name === "build.json" ? build! : id, {customMetadata: {sha256: entry.sha256}});
  await env.FRONTEND_RELEASES!.put(`releases/${id}/sealed.json`, sealed);
  await env.DB.prepare("INSERT INTO frontend_releases VALUES(?,?,?,?,?)").bind(id,await digest(sealed),releaseContract,Date.now(),ready).run();
}
beforeEach(async () => {
  await env.DB.batch(["DELETE FROM release_promotions", "DELETE FROM release_channels", "DELETE FROM release_compatibility", "DELETE FROM release_verification", "DELETE FROM frontend_releases", "DELETE FROM release_operators"].map(s=>env.DB.prepare(s)));
  for (const o of (await env.FRONTEND_RELEASES!.list()).objects) await env.FRONTEND_RELEASES!.delete(o.key);
  await release(A); await release(B);
  await env.DB.prepare("INSERT INTO release_channels VALUES(1,?,?,1)").bind(A,B).run();
});
it("keeps cold navigation stable while beta advances and selects one matching SW", async () => {
  expect(await (await call("/choirs/deep")).text()).toContain(A);
  await release(C); await env.DB.prepare("UPDATE release_channels SET beta=?,revision=2").bind(C).run();
  expect(await (await call("/")).text()).toContain(A);
  const intent = crypto.randomUUID();
  const beta = await call("/sw.js",{headers:{Cookie:`same-page-channel=beta.${intent}`}});
  expect(await beta.text()).toBe(C);expect(beta.headers.get("cache-control")).toBe("private, no-store");
  expect((await call("/" )).headers.get("cache-control")).toBe("private, no-store");
  const target = await (await call("/api/client-release",{headers:{Cookie:`same-page-channel=beta.${intent}`}})).json();
  expect(target).toMatchObject({channel:"beta",target:C,intent});
});
it("never substitutes HTML for missing immutable resources or changes bytes based on cookies", async () => {
  const path = `/_releases/${A}/app.js`;
  expect(await (await call(path,{headers:{Cookie:`same-page-channel=beta.${crypto.randomUUID()}`}})).text()).toBe(A);
  expect((await call(path)).headers.get("cache-control")).toContain("immutable");
  expect((await call(`/_releases/${A}/missing.js`)).status).toBe(404);
  expect((await call("/missing.js")).status).toBe(404);
  expect((await call("/api/missing")).headers.get("content-type")).toContain("json");
});
it("retains archived third-party resources while bridge routing is disabled", async () => {
  const file = 'third-party/alphatab/legacy-core.js', bytes = 'supported legacy decoder';
  await env.FRONTEND_RELEASES!.put(`legacy/${file}`, bytes, { customMetadata: { sha256: await digest(bytes), contentType: 'text/javascript' } });
  const bridgeCall = async (path: string, method = 'GET') => {
    const context = createExecutionContext();
    const response = await worker.fetch(new Request(`https://same-page.test/${path}`, { method }), {
      ...env, RELEASE_CHANNELS_ENABLED: 'false',
      // The static service's SPA fallback must not become a legacy script.
      ASSETS: {
        fetch: async () => new Response('<html>current shell</html>', { headers: { 'Content-Type': 'text/html' } }),
        connect: () => { throw new Error('Static assets cannot open sockets'); },
      },
    }, context);
    await waitOnExecutionContext(context);
    return response;
  };
  const response = await bridgeCall(file);
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('text/javascript');
  expect(response.headers.get('cache-control')).toContain('immutable');
  expect(await response.text()).toBe(bytes);
  const head = await bridgeCall(file, 'HEAD');
  expect(head.status).toBe(200);
  expect(await head.text()).toBe('');
  expect((await bridgeCall('third-party/alphatab/missing.js')).status).toBe(404);
});
it("allows fixed staged verification but never selects it through a pointer", async () => {
  await release(C,0);
  expect((await call(`/_releases/${C}/app.js`)).status).toBe(200);
  await env.DB.prepare("UPDATE release_channels SET beta=?").bind(C).run();
  expect((await call("/sw.js",{headers:{Cookie:`same-page-channel=beta.${crypto.randomUUID()}`}})).status).toBe(404);
  expect((await call("/api/client-release",{headers:{Cookie:`same-page-channel=beta.${crypto.randomUUID()}`}})).status).toBe(503);
});
it("requires same-origin explicit selection with a durable separate cookie", async () => {
  const body=JSON.stringify({channel:"beta",intent:crypto.randomUUID()});
  expect((await call("/api/client-release",{method:"POST",body})).status).toBe(403);
  const r=await call("/api/client-release",{method:"POST",headers:{Origin:"https://same-page.test","Content-Type":"application/json"},body});
  expect(r.status).toBe(204);expect(r.headers.get("set-cookie")).toMatch(/Secure; HttpOnly; SameSite=Lax; Max-Age=31536000/);
});
it("fails closed for a missing or corrupt stable release",async()=>{
  await env.FRONTEND_RELEASES!.put(`releases/${A}/sealed.json`,"{}");
  expect((await call("/")).status).toBe(404);
  expect((await call("/api/client-release")).status).toBe(503);
});
it("uses a single SQL operation to reject stale promotions and recheck separate authority",async()=>{
  const id=crypto.randomUUID(),session=crypto.randomUUID(),now=Date.now();
  await env.DB.prepare("INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES(?,'release','release@example.test',1,?,?)").bind(id,now,now).run();
  await env.DB.prepare("INSERT INTO session(id,token,user_id,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?)").bind(session,crypto.randomUUID(),id,now+60000,now,now).run();
  const promote=()=>env.DB.prepare("INSERT INTO release_promotions VALUES(?,?,?,?,?,?,?)").bind(crypto.randomUUID(),id,session,B,1,A,Date.now()).run();
  await expect(promote()).rejects.toThrow();
  await env.DB.prepare("INSERT INTO release_operators VALUES(?)").bind(id).run();
  await env.DB.prepare("INSERT INTO release_compatibility VALUES(?,?,?,?,?)").bind(B,A,"c".repeat(64),"c".repeat(64),"d".repeat(64)).run();
  await promote();expect(await env.DB.prepare("SELECT stable,revision FROM release_channels").first()).toEqual({stable:B,revision:2});
  await expect(promote()).rejects.toThrow();
  expect((await env.DB.prepare("SELECT * FROM release_promotions").all()).results).toHaveLength(1);
  await env.DB.prepare("DELETE FROM user WHERE id=?").bind(id).run();
});
it("rejects different bytes for every immutable key including the claim and seal",async()=>{
  const bucket=env.FRONTEND_RELEASES!;
  await bucket.put("claim-probe","A", {onlyIf:{etagDoesNotMatch:"*"}});
  expect(await bucket.put("claim-probe","B", {onlyIf:{etagDoesNotMatch:"*"}})).toBeNull();
  expect(await(await bucket.get("claim-probe"))!.text()).toBe("A");
});

it("reads only the sealed build version and tolerates legacy or invalid metadata", async () => {
  expect(await releaseVersion(env, A)).toBe("v26.10.22.1200");
  await release(C, 1, null);
  expect(await releaseVersion(env, C)).toBeNull();
  const mismatched = "d".repeat(40);
  await release(mismatched, 1, { buildId: A, version: "v26.10.22.1200" });
  expect(await releaseVersion(env, mismatched)).toBeNull();
  const invalid = "e".repeat(40);
  await release(invalid, 1, { buildId: invalid, version: "invented-version" });
  expect(await releaseVersion(env, invalid)).toBeNull();
  await env.FRONTEND_RELEASES!.put(`releases/${A}/build.json`, JSON.stringify({ buildId: A, version: "v26.10.22.1201" }));
  expect(await releaseVersion(env, A)).toBeNull();
});

it("reads advisory verification only for the matching release and immutable manifest", async () => {
  const row = await env.DB.prepare('SELECT manifest_digest FROM frontend_releases WHERE build_id=?').bind(B).first<{manifest_digest:string}>();
  await env.DB.prepare('INSERT INTO release_verification VALUES(?,?,?,?,?,?)').bind(B,row!.manifest_digest,123,1,'success',Date.now()).run();
  expect(await extendedVerification(env, B)).toMatchObject({ buildId: B, status: 'success', runId: 123 });
  expect(await extendedVerification(env, A)).toBeNull();
  await env.DB.prepare('UPDATE release_verification SET manifest_digest=? WHERE build_id=?').bind('f'.repeat(64),B).run();
  expect(await extendedVerification(env, B)).toBeNull();
  await env.DB.prepare('UPDATE release_verification SET manifest_digest=?,status=?,updated_at=? WHERE build_id=?').bind(row!.manifest_digest,'running',Date.now()-3600001,B).run();
  expect(await extendedVerification(env, B)).toBeNull();
});

it("separates release authority from XML authority and retries exactly one audited promotion",async()=>{
  const user=crypto.randomUUID(),now=Date.now(),password='release-fixture-password';
  await env.DB.batch([
    env.DB.prepare("INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES(?,'release','release-api@example.test',1,?,?)").bind(user,now,now),
    env.DB.prepare("INSERT INTO account(id,account_id,provider_id,user_id,password,created_at,updated_at) VALUES(?,?,'credential',?,?,?,?)").bind(crypto.randomUUID(),user,user,await hashPassword(password),now,now),
    env.DB.prepare("INSERT INTO product_operators(user_id,view_scores) VALUES(?,1)").bind(user),
  ]);
  try {
    const login=await call('/api/auth/sign-in/email',{method:'POST',headers:{Origin:'https://same-page.test','Content-Type':'application/json'},body:JSON.stringify({email:'release-api@example.test',password})});
    expect(login.status).toBe(200);const cookie=login.headers.get('set-cookie')!.split(';')[0];
    const headers={Cookie:cookie,Origin:'https://same-page.test','Content-Type':'application/json'};
    expect((await call('/api/admin/releases',{headers})).status).toBe(403);
    await env.DB.prepare('INSERT INTO release_operators VALUES(?)').bind(user).run();
    const candidate = await env.DB.prepare('SELECT manifest_digest FROM frontend_releases WHERE build_id=?').bind(B).first<{manifest_digest:string}>();
    await env.DB.prepare('INSERT INTO release_verification VALUES(?,?,?,?,?,?)').bind(B,candidate!.manifest_digest,123,1,'failure',Date.now()).run();
    const catalog = await call('/api/admin/releases', { headers });
    expect(catalog.status).toBe(200);
    expect(await catalog.json()).toMatchObject({ verification: { buildId:B, status:'failure', runId:123 }, storageCompatible:false, releases: expect.arrayContaining([
      expect.objectContaining({ buildId: A, version: 'v26.10.22.1200' }),
      expect.objectContaining({ buildId: B, version: 'v26.10.22.1530' }),
    ]) });
    const input={id:crypto.randomUUID(),expectedBeta:B,expectedRevision:1};
    const promote=()=>call('/api/admin/releases/promote',{method:'POST',headers,body:JSON.stringify(input)});
    expect((await promote()).status).toBe(503); // A ready artifact alone is not a compatibility proof.
    const report=JSON.stringify({version:1,passed:true,stable:A,candidate:B,stableProbe:'0'.repeat(64),candidateProbe:'0'.repeat(64),engines:['chromium','webkit']});
    await env.FRONTEND_RELEASES!.put(`compatibility/${B}/${A}.json`,report);
    await env.DB.prepare('INSERT INTO release_compatibility VALUES(?,?,?,?,?)').bind(B,A,'0'.repeat(64),'0'.repeat(64),await digest(report)).run();
    expect(await (await call('/api/admin/releases', { headers })).json()).toMatchObject({storageCompatible:true});
    expect((await promote()).status).toBe(204);expect((await promote()).status).toBe(204);
    expect((await env.DB.prepare('SELECT * FROM release_promotions').all()).results).toHaveLength(1);
    const promoted = await (await call('/api/admin/releases', { headers })).json();
    expect(promoted).toMatchObject({ stable: B, beta: B, releases: expect.arrayContaining([
      expect.objectContaining({ buildId: A, version: 'v26.10.22.1200' }),
      expect.objectContaining({ buildId: B, version: 'v26.10.22.1530' }),
    ]), events: [expect.objectContaining({ previousStable: A, target: B })] });
    await env.FRONTEND_RELEASES!.delete(`releases/${A}/build.json`);
    const legacy = await call('/api/admin/releases', { headers });
    expect(legacy.status).toBe(200);
    expect(await legacy.json()).toMatchObject({ releases: expect.arrayContaining([expect.objectContaining({ buildId: A, version: null })]) });
    await env.DB.prepare('DELETE FROM release_operators WHERE user_id=?').bind(user).run();
    expect((await promote()).status).toBe(403);
  }finally{await env.DB.prepare('DELETE FROM user WHERE id=?').bind(user).run()}
});
