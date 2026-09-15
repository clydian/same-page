import type { Context } from "hono";
import type { AppEnvironment } from "../env";
import { measureServerTiming } from "../performance/server-timing";

// Call only after resolving current access and a live file reference.
export async function serveStoredFile(context: Context<AppEnvironment>, file: {
  objectKey: string; sizeBytes: number; etag: string; contentType: string;
  headers?: Record<string, string>; unavailableCode?: string;
}) {
  const headers = new Headers({
    "Accept-Ranges": "bytes", "Cache-Control": "private, no-cache",
    "Content-Type": file.contentType, ETag: file.etag,
    "X-Content-Type-Options": "nosniff", ...file.headers,
  });
  const rangeHeader = context.req.header("Range");
  const ifRange = context.req.header("If-Range");
  const useRange = rangeHeader && (!ifRange || ifRange === file.etag);
  const range = useRange ? parseRange(rangeHeader, file.sizeBytes) : null;
  if (useRange && !range) {
    headers.set("Content-Range", `bytes */${file.sizeBytes}`);
    return new Response(null, { status: 416, headers });
  }

  const noneMatch = context.req.header("If-None-Match")?.split(/\s*,\s*/);
  if (!range && (noneMatch?.includes(file.etag) || noneMatch?.includes("*"))) {
    return new Response(null, { status: 304, headers });
  }

  if (range) {
    headers.set("Content-Length", String(range.length));
    headers.set(
      "Content-Range",
      `bytes ${range.offset}-${range.offset + range.length - 1}/${file.sizeBytes}`,
    );
  } else {
    headers.set("Content-Length", String(file.sizeBytes));
  }
  const status = range ? 206 : 200;
  if (context.req.method === "HEAD") {
    return new Response(null, { status, headers });
  }

  const object = await measureServerTiming(context, "r2", () =>
    context.env.SCORES_BUCKET.get(file.objectKey, {
      ...(range ? { range } : {}),
    }));
  if (!object || !("body" in object)) {
    return context.json({ error: file.unavailableCode ?? "file_unavailable" }, 503);
  }
  return new Response(object.body, { status, headers });
}

function parseRange(
  value: string,
  size: number,
): { offset: number; length: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2])) return null;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    const length = Math.min(suffix, size);
    return { offset: size - length, length };
  }
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    requestedEnd < start ||
    start >= size
  ) {
    return null;
  }
  const end = Math.min(requestedEnd, size - 1);
  return { offset: start, length: end - start + 1 };
}

