import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import worker from "../index";
import { releaseContract } from "../../src/shared/release-channels";
const A = "a".repeat(40), B = "b".repeat(40), C = "c".repeat(40);
const digest = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))), b => b.toString(16).padStart(2, "0")).join("");
const call = (path: string, init?: RequestInit) => worker.fetch(new Request(`https://same-page.test${path}`, init), { ...env, RELEASE_CHANNELS_ENABLED: "true" });
async function release(id: string, ready = 1) {
  const html = `<meta name="same-page-build-id" content="${id}">`;
  const files = { "index.html": { sha256: await digest(html), bytes: html.length, contentType: "text/html" }, "app.js": { sha256: await digest(id), bytes: id.length, contentType: "text/javascript" }, "sw.js": { sha256: await digest(id), bytes: id.length, contentType: "text/javascript" } };
  const sealed = JSON.stringify({ storageDigest: "0".repeat(64), buildId: id, contract: releaseContract, files });
  for (const [name,entry] of Object.entries(files)) await env.FRONTEND_RELEASES!.put(`releases/${id}/${name}`, name === "index.html" ? html : id, {customMetadata: {sha256: entry.sha256}});
  await env.FRONTEND_RELEASES!.put(`releases/${id}/sealed.json`, sealed);
  await env.DB.prepare("INSERT INTO frontend_releases VALUES(?,?,?,?,?)").bind(id,await digest(sealed),releaseContract,Date.now(),ready).run();
}
beforeEach(async () => {
  await env.DB.batch(["DELETE FROM release_promotions", "DELETE FROM release_channels", "DELETE FROM frontend_releases", "DELETE FROM release_operators"].map(s=>env.DB.prepare(s)));
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
