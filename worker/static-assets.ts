export const appShellPermissions = 'camera=(), geolocation=(), microphone=(self)';

// A document can enter sight singing through client-side navigation. Apply the
// policy to the successful app shell, including the copy the PWA precaches.
export async function serveStaticAppShell(request: Request, assets: Pick<Fetcher, 'fetch'>): Promise<Response> {
  const response = await assets.fetch(request);
  const html = response.ok && /\btext\/html\b/i.test(response.headers.get('content-type') ?? '');
  const revalidated = response.status === 304 && request.headers.get('Sec-Fetch-Dest') === 'document';
  if (!html && !revalidated) return response;
  const headers = new Headers(response.headers);
  headers.set('Permissions-Policy', appShellPermissions);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

// The SPA asset service can return index.html (and its path-based immutable
// header) for a missing hashed file. Never let that response become a script.
export async function serveStaticAsset(request: Request, assets: Pick<Fetcher, 'fetch'>): Promise<Response> {
  const response = await assets.fetch(request);
  if (response.status === 404 || /\btext\/html\b/i.test(response.headers.get('content-type') ?? '')) {
    return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  }
  return response;
}
