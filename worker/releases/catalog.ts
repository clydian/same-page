import type { Env } from "../env";
import { releaseContract, releaseManifestSchema, type ReleaseManifest, type ReleaseChannel } from "../../src/shared/release-channels";
export type ChannelRow = { stable: string; beta: string; revision: number };
export function releaseDB(env: Env) { return env.DB.withSession("first-primary"); }
export async function channels(env: Env) {
  return releaseDB(env).prepare("SELECT stable,beta,revision FROM release_channels WHERE id=1").first<ChannelRow>();
}
export function preference(request: Request): { channel: ReleaseChannel; intent: string } {
  const value = request.headers.get("cookie")?.split(/;\s*/).find(v => v.startsWith("same-page-channel="))?.slice(18);
  const match = /^(stable|beta)\.([a-f0-9-]{36})$/.exec(value ?? "");
  return match ? { channel: match[1] as ReleaseChannel, intent: match[2] } : { channel: "stable", intent: "default" };
}
export async function manifest(env: Env, id: string, staged = false): Promise<ReleaseManifest | null> {
  const row = await releaseDB(env).prepare("SELECT manifest_digest AS digest FROM frontend_releases WHERE build_id=? AND (ready=1 OR ?=1) AND contract=?").bind(id, staged ? 1 : 0, releaseContract).first<{ digest: string }>();
  if (!row || !env.FRONTEND_RELEASES) return null;
  const object = await env.FRONTEND_RELEASES.get(`releases/${id}/sealed.json`);
  if (!object || object.size > 512 * 1024) return null;
  const bytes = await object.arrayBuffer();
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
  if (digest !== row.digest) return null;
  const parsed = releaseManifestSchema.safeParse(JSON.parse(new TextDecoder().decode(bytes)));
  return parsed.success && parsed.data.buildId === id ? parsed.data : null;
}
