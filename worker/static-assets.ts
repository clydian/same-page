// The SPA asset service can return index.html (and its path-based immutable
// header) for a missing hashed file. Never let that response become a script.
export async function serveStaticAsset(request: Request, assets: Pick<Fetcher, 'fetch'>): Promise<Response> {
  const response = await assets.fetch(request);
  if (response.status === 404 || /\btext\/html\b/i.test(response.headers.get('content-type') ?? '')) {
    return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  }
  return response;
}
