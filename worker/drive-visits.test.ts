import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { hashPassword } from "better-auth/crypto";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import worker from "./index";
import { provisionChoir } from "./choirs/provision";
import { cleanupDriveVisits } from "./choirs/visits";
import { VISIT_INTERVAL_MS } from "../src/shared/drive-usage";

const password = "visit-test-password", hash = await hashPassword(password);
let owner: string, operator: string, ownerCookie: string, operatorCookie: string, drive: string, member: string;
async function call(path: string, cookie = "", init: RequestInit = {}) {
  const ctx = createExecutionContext();
  const r = await worker.fetch(new Request(`https://same-page.test/api${path}`, {
    ...init, headers: { origin: "https://same-page.test", cookie, ...init.headers },
  }), env, ctx);
  await waitOnExecutionContext(ctx);
  return r;
}
async function user(email: string) {
  const id = crypto.randomUUID(), now = Date.now();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES(?,'测试',?,1,?,?)").bind(id, email, now, now),
    env.DB.prepare("INSERT INTO account(id,account_id,provider_id,user_id,password,created_at,updated_at) VALUES(?,?,'credential',?,?,?,?)").bind(crypto.randomUUID(), id, id, hash, now, now),
  ]);
  const r = await call("/auth/sign-in/email", "", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  expect(r.status).toBe(200);
  return { id, cookie: r.headers.get("set-cookie")!.split(";")[0] };
}
const visit = (cookie = ownerCookie, id = owner, headers = {}) => call(`/choirs/${drive}/visits`, cookie, {
  method: "POST", headers: { "x-same-page-owner-user-id": id, "x-same-page-visit": "foreground", ...headers },
});
const records = () => env.DB.prepare("SELECT * FROM drive_member_visits").all();
beforeEach(async () => {
  await env.DB.batch(["DELETE FROM choirs", "DELETE FROM user", "DELETE FROM rate_limits"].map(sql => env.DB.prepare(sql)));
  const a = await user("visit-owner@example.test"), b = await user("visit-operator@example.test");
  owner = a.id; ownerCookie = a.cookie; operator = b.id; operatorCookie = b.cookie;
  drive = (await provisionChoir({ binding: env.DB, ownerUserId: owner, ownerDisplayName: "拥有者", inviteSecret: env.INVITE_SECRET })).choirId;
  member = (await env.DB.prepare("SELECT id FROM memberships WHERE choir_id=? AND user_id=?").bind(drive, owner).first<{ id: string }>())!.id;
  await env.DB.prepare("INSERT INTO product_operators(user_id) VALUES(?)").bind(operator).run();
});
afterEach(() => vi.restoreAllMocks());

it("records only fenced active members, excluding operators, previews and polling", async () => {
  expect((await visit("")).status).toBe(401);
  expect((await visit(operatorCookie, operator)).status).toBe(204);
  expect((await visit(ownerCookie, operator)).status).toBe(403);
  expect((await visit(ownerCookie, owner, { "x-same-page-visit": "poll" })).status).toBe(400);
  expect((await call(`/choirs/${drive}/usage`, ownerCookie)).status).toBe(200);
  expect((await call("/admin/drive-usage", operatorCookie)).status).toBe(200);
  expect((await records()).results).toHaveLength(0);
  for (const table of ["product_operators", "diagnostic_operators", "release_operators"]) {
    await env.DB.prepare(`INSERT INTO ${table}(user_id) VALUES(?)`).bind(owner).run();
    expect((await visit()).status).toBe(204);
    expect((await records()).results).toHaveLength(0);
    await env.DB.prepare(`DELETE FROM ${table} WHERE user_id=?`).bind(owner).run();
  }
  await env.DB.prepare("UPDATE choirs SET is_preview_entry=1,guest_admission_mode='open',join_code_hash=NULL WHERE id=?").bind(drive).run();
  expect((await visit()).status).toBe(204);
  expect((await records()).results).toHaveLength(0);
  await env.DB.prepare("UPDATE choirs SET is_preview_entry=0,purged_at=? WHERE id=?").bind(Date.now(), drive).run();
  expect((await visit()).status).toBe(404);
});

it("atomically samples once per five minutes, uses server time and retains only 30-day member metadata", async () => {
  const now = Date.now(); vi.spyOn(Date, "now").mockReturnValue(now);
  expect((await visit()).status).toBe(204);
  await Promise.all([visit(), visit(), visit()]);
  expect((await records()).results).toMatchObject([{ membership_id: member, last_seen_at: now }]);
  vi.spyOn(Date, "now").mockReturnValue(now + VISIT_INTERVAL_MS - 1);
  await visit();
  expect((await records()).results[0].last_seen_at).toBe(now);
  vi.spyOn(Date, "now").mockReturnValue(now + VISIT_INTERVAL_MS);
  await visit();
  const last = now + VISIT_INTERVAL_MS;
  expect((await records()).results[0].last_seen_at).toBe(last);
  await cleanupDriveVisits(env.DB, last + 30 * 86400000);
  expect((await records()).results).toHaveLength(1);
  await cleanupDriveVisits(env.DB, last + 30 * 86400000 + 1);
  expect((await records()).results).toHaveLength(0);
  expect(await env.DB.prepare("SELECT last_member_visit_at FROM choirs WHERE id=?").bind(drive).first()).toEqual({ last_member_visit_at: last });
});

it("protects aggregate reads, preserves unknown history and uses actual limits and rolling valid-member counts", async () => {
  expect((await call("/admin/drive-usage", ownerCookie)).status).toBe(403);
  const initial = await (await call("/admin/drive-usage", operatorCookie)).json<{ drives: { lastMemberVisitAt: number | null }[]; collectionStartedAt: number }>();
  expect(initial.drives[0].lastMemberVisitAt).toBeNull();
  expect(initial.collectionStartedAt).toBeGreaterThan(0);
  const now = Date.now(); vi.spyOn(Date, "now").mockReturnValue(now);
  const second = crypto.randomUUID();
  const visitor = await user("visit-second@example.test");
  await env.DB.batch([
    env.DB.prepare("INSERT INTO memberships(id,choir_id,user_id,display_name,status) VALUES(?,?,?,'成员','active')").bind(second, drive, visitor.id),
    env.DB.prepare("INSERT INTO drive_member_visits VALUES(?,?,?)").bind(member, drive, now - 7 * 86400000),
    env.DB.prepare("INSERT INTO drive_member_visits VALUES(?,?,?)").bind(second, drive, now - 30 * 86400000),
    env.DB.prepare("UPDATE choirs SET storage_limit_bytes=123456, member_limit=100,score_limit=NULL WHERE id=?").bind(drive),
  ]);
  const read = async () => (await (await call("/admin/drive-usage", operatorCookie)).json<{ drives: Record<string, unknown>[] }>()).drives[0];
  expect(await read()).toMatchObject({ visitors7d: 1, visitors30d: 2, memberCount: 2, limitBytes: 123456, memberLimit: 100, scoreLimit: null });
  await env.DB.prepare("UPDATE memberships SET status='removed',removed_at=? WHERE id=?").bind(now, second).run();
  expect((await visit(visitor.cookie, visitor.id)).status).toBe(204);
  expect(await read()).toMatchObject({ visitors7d: 1, visitors30d: 1, memberCount: 1 });
  const filtered = await (await call("/admin/drive-usage?q=nonexistent", operatorCookie)).json<{ drives: unknown[] }>();
  expect(filtered.drives).toEqual([]);
  await env.DB.prepare("DELETE FROM choirs WHERE id=?").bind(drive).run();
  expect((await records()).results).toHaveLength(0);
});
