import { mkdir, writeFile } from 'node:fs/promises';

// Synthetic connection fixtures only. Never record cookies, headers, bodies,
// query strings, fragments, session/user IDs, form values or raw error messages.
export async function withConnectionEvidence(page, { directory, origins, network }, run) {
  const started = performance.now();
  const timeline = [];
  const requests = new Map();
  let nextRequest = 0;
  const entry = origin => origin === origins.direct ? 'direct' : origin === origins.backup ? 'backup' : 'other';
  const record = event => {
    timeline.push({ ms: Math.round(performance.now() - started), ...event });
    if (timeline.length > 200) timeline.shift();
  };
  const request = value => {
    const url = new URL(value.url());
    if (!url.pathname.startsWith('/api/')) return;
    const id = ++nextRequest;
    requests.set(value, id);
    record({ event: 'request', id, entry: entry(url.origin), method: value.method(), pathname: url.pathname });
  };
  const response = value => {
    const id = requests.get(value.request());
    if (id) record({ event: 'response', id, status: value.status() });
  };
  const finished = value => {
    const id = requests.get(value);
    if (id) record({ event: 'finished', id });
    requests.delete(value);
  };
  const failed = value => {
    const id = requests.get(value);
    if (id) record({ event: 'failed', id });
    requests.delete(value);
  };
  const pageError = error => {
    const type = ['Error', 'TypeError', 'ReferenceError', 'RangeError', 'SyntaxError'].includes(error.name) ? error.name : 'OtherError';
    record({ event: 'page-error', type });
  };
  const crash = () => record({ event: 'page-crash' });
  const navigated = frame => {
    if (frame === page.mainFrame()) record({ event: 'navigation', pathname: new URL(frame.url()).pathname });
  };
  const listeners = { request, response, requestfinished: finished, requestfailed: failed, pageerror: pageError, crash, framenavigated: navigated };
  for (const [event, listener] of Object.entries(listeners)) page.on(event, listener);
  try {
    return await run(stage => record({ event: 'stage', stage }));
  } catch (error) {
    const failureAtMs = Math.round(performance.now() - started);
    try {
      let timer;
      let state;
      try {
        state = await Promise.race([
          page.evaluate(async () => {
            const { authClient } = await import('/src/client/auth/auth-client.ts');
            const { connections } = await import('/src/client/connection/connection.ts');
            const session = authClient.$store.atoms.session.get();
            const { mode, active, checking, preparing, health, identity } = connections.getSnapshot();
            const fab = document.querySelector('.upload-fab');
            const rect = fab?.getBoundingClientRect();
            const style = fab && getComputedStyle(fab);
            return {
              session: { pending: session.isPending, refetching: session.isRefetching,
                hasUser: Boolean(session.data?.user), hasSession: Boolean(session.data?.session),
                errorStatus: typeof session.error?.status === 'number' ? session.error.status : null },
              connection: { mode, active, checking, preparing,
                health: Object.fromEntries(['direct', 'backup'].map(route => [route, { state: health[route].state, checkedAt: health[route].checkedAt, latency: health[route].latency }])),
                identity: { direct: identity.direct, backup: identity.backup } },
              page: { pathname: location.pathname, hasFragment: Boolean(location.hash), visibility: document.visibilityState,
                readyState: document.readyState, scrollY, viewport: { width: innerWidth, height: innerHeight },
                errorBoundary: document.body.textContent.includes('乐谱云盘加载失败'),
                alertCount: document.querySelectorAll('[role="alert"]').length,
                fileRows: document.querySelectorAll('.file-row__open').length,
                connectionPanel: Boolean(document.querySelector('.connection-dialog')) },
              upload: fab ? { exists: true, inert: fab.inert, inertAncestor: Boolean(fab.closest('[inert]')),
                ariaHiddenAncestor: Boolean(fab.closest('[aria-hidden="true"]')), disabled: fab.disabled,
                visible: fab.getAttribute('data-visible'), display: style.display, visibility: style.visibility,
                rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } } : { exists: false },
            };
          }).catch(() => ({ stateUnavailable: 'capture failed' })),
          new Promise(resolve => { timer = setTimeout(() => resolve({ stateUnavailable: 'capture timed out' }), 2500); }),
        ]);
      } finally { clearTimeout(timer); }
      await mkdir(directory, { recursive: true });
      await writeFile(`${directory}/failure.json`, JSON.stringify({ failureAtMs,
        capturedAtMs: Math.round(performance.now() - started),
        pageEntry: entry(new URL(page.url()).origin),
        fixture: { directBroken: network.directBroken, loseUploadResponse: network.loseUploadResponse, uploads: network.uploads },
        state, timeline }, null, 2));
      await page.screenshot({ path: `${directory}/page.png`, timeout: 3000,
        mask: [page.locator('input, textarea, [contenteditable], .annotation-overlay')] }).catch(() => {});
      console.log(`Connection failure evidence: ${directory}/failure.json`);
    } catch {
      console.log('Connection failure evidence capture incomplete');
    }
    throw error;
  } finally {
    for (const [event, listener] of Object.entries(listeners)) page.off(event, listener);
  }
}
