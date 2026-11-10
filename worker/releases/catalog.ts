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

// Only the current stable synthetic storage probe is public. No user data,
// bucket access, arbitrary key lookup or extra persistent copy is exposed.
export async function stableStorageBaseline(env: Env) {
  const pointer = await channels(env);
  const release = pointer && await manifest(env, pointer.stable);
  if (!release || !env.FRONTEND_RELEASES) return null;
  const readVerified = async (name: string, expected: string, maxBytes: number) => {
    const object = await env.FRONTEND_RELEASES!.get(`releases/${release.buildId}/${name}`);
    if (!object || object.size > maxBytes) return null;
    const bytes = await object.arrayBuffer();
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
    return hash === expected ? new TextDecoder("utf-8", { fatal: true }).decode(bytes) : null;
  };
  const [storage, probe] = await Promise.all([
    readVerified("storage.json", release.storageDigest, 512 * 1024),
    readVerified("storage-probe.js", release.probeDigest, 2 * 1024 * 1024),
  ]);
  if (!storage || !probe) return null;
  return { version: 1, buildId: release.buildId, storage, probe, storageDigest: release.storageDigest, probeDigest: release.probeDigest };
}

// Display metadata comes from the same immutable bytes as the running app.
// Older or unavailable metadata must not prevent viewing the release catalog.
export async function releaseVersion(env: Env, id: string): Promise<string | null> {
  try {
    const release = await manifest(env, id), entry = release?.files["build.json"];
    if (!entry || entry.bytes > 512 * 1024) return null;
    const object = await env.FRONTEND_RELEASES!.get(`releases/${id}/build.json`);
    if (!object || object.size !== entry.bytes) return null;
    const bytes = await object.arrayBuffer();
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
    if (digest !== entry.sha256) return null;
    const identity = JSON.parse(new TextDecoder().decode(bytes));
    return identity?.buildId === id && typeof identity.version === "string" && /^v\d{2}\.\d{2}\.\d{2}\.\d{4}$/.test(identity.version) ? identity.version : null;
  } catch { return null; }
}

export async function compatibilityReady(env: Env, stable: string, candidate: string) {
  const proof = await releaseDB(env).prepare("SELECT report_digest AS digest FROM release_compatibility WHERE stable=? AND candidate=?").bind(stable,candidate).first<{ digest: string }>();
  if (!proof || !env.FRONTEND_RELEASES) return false;
  const object = await env.FRONTEND_RELEASES.get(`compatibility/${candidate}/${stable}.json`);
  if (!object || object.size > 4096) return false;
  const bytes = await object.arrayBuffer();
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),b=>b.toString(16).padStart(2,"0")).join("");
  if (digest !== proof.digest) return false;
  try {
    const report = JSON.parse(new TextDecoder().decode(bytes));
    const [a,b] = await Promise.all([manifest(env,stable),manifest(env,candidate)]);
    return report.version === 1 && report.passed === true && report.stable === stable && report.candidate === candidate &&
      JSON.stringify(report.engines) === '["chromium","webkit"]' && report.stableProbe === a?.probeDigest && report.candidateProbe === b?.probeDigest;
  } catch { return false; }
}

// Optional advisory data must never make the release catalog unavailable during
// rolling deployment, migration failures, or for releases made before it existed.
export async function extendedVerification(env: Env, candidate: string) {
  try {
    const row = await releaseDB(env).prepare(`SELECT v.status, v.updated_at AS updatedAt, v.run_id AS runId
      FROM release_verification v JOIN frontend_releases r ON r.build_id=v.build_id
      WHERE v.build_id=? AND r.ready=1 AND v.manifest_digest=r.manifest_digest`).bind(candidate)
      .first<{ status: string; updatedAt: number; runId: number }>();
    if (!row || !['running', 'success', 'failure', 'cancelled'].includes(row.status) ||
      !Number.isSafeInteger(row.runId) || row.runId <= 0 || !Number.isSafeInteger(row.updatedAt) || row.updatedAt <= 0) return null;
    // A cancelled workflow or failed reporter must not appear to run forever.
    if (row.status === 'running' && Date.now() - row.updatedAt > 60 * 60 * 1000) return null;
    return { buildId: candidate, status: row.status, updatedAt: row.updatedAt, runId: row.runId };
  } catch { return null; }
}
