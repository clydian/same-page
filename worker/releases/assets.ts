import { releasePrefix } from "../../src/shared/release-channels";
import type { Env } from "../env";
import { channels, manifest, preference } from "./catalog";
const security = {
  "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Frame-Options": "SAMEORIGIN",
  "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Resource-Policy": "same-origin", "Origin-Agent-Cluster": "?1",
  "Permissions-Policy": "camera=(), geolocation=(), microphone=()", "Strict-Transport-Security": "max-age=15552000; includeSubDomains",
};
const unavailable = (status = 503) => new Response("暂时无法取得应用版本，请联网后重试。此设备保存的内容仍然保留。", { status, headers: { ...security, "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store" } });
export async function legacyAsset(request: Request, env: Env): Promise<Response | null> {
  const file = new URL(request.url).pathname.slice(1);
  if (!env.FRONTEND_RELEASES || !/^(?:assets|pdfjs|font|soundfont|playback|third-party)\//.test(file) || /(?:\.\.|%)/.test(file)) return null;
  const object = await env.FRONTEND_RELEASES.get('legacy/' + file);
  if (!object || !object.customMetadata?.sha256) return null;
  return new Response(request.method === 'HEAD' ? null : object.body, { headers: { ...security, 'Content-Type': object.customMetadata.contentType ?? 'application/octet-stream', 'Cache-Control': 'public, max-age=31536000, immutable' } });
}
export async function serveReleaseAsset(request: Request, env: Env): Promise<Response> {
  if (!["GET", "HEAD"].includes(request.method)) return unavailable(405);
  const url = new URL(request.url);
  const fixed = /^\/_releases\/([a-f0-9]{40})\/(.+)$/.exec(url.pathname);
  if (url.pathname.startsWith("/_releases/") && !fixed) return unavailable(404);
  let id = fixed?.[1], file = fixed?.[2];
  if (!id) {
    const pointers = await channels(env);
    if (!pointers) return unavailable();
    id = pointers[preference(request).channel];
    const name = url.pathname.slice(1);
    // Legacy public resources have exact names; unknown files are never HTML.
    file = name === "sw.js" || name === "build.json" || name === "manifest.webmanifest" || /\.[a-z0-9]+$/i.test(name) || /^(?:assets|pdfjs|font|soundfont|playback|third-party)\//.test(name) ? name : "index.html";
  }
  if (!file || file.includes("..") || file.includes("%") || file.startsWith("/") || file.startsWith("_")) return unavailable(404);
  const release = await manifest(env, id, Boolean(fixed));
  const entry = release?.files[file];
  if (!entry) return !fixed && file !== "index.html" ? await legacyAsset(request, env) ?? unavailable(404) : unavailable(404);
  const object = await env.FRONTEND_RELEASES!.get(`releases/${id}/${file}`);
  if (!object || object.size !== entry.bytes || object.customMetadata?.sha256 !== entry.sha256) return unavailable(404);
  const headers = new Headers({ ...security, "Content-Type": entry.contentType, "Content-Length": String(object.size), ETag: object.httpEtag,
    "Cache-Control": fixed ? "public, max-age=31536000, immutable" : "private, no-store", "X-Same-Page-Frontend": id });
  if (file === "sw.js") { headers.set("Service-Worker-Allowed", "/"); headers.set("Cache-Control", "private, no-store"); }
  // Prefix paths are physical files, never directory/HTML redirects.
  if (file === "index.html") headers.set("Content-Location", releasePrefix(id) + "index.html");
  return new Response(request.method === "HEAD" ? null : object.body, { headers });
}
