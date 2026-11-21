// Browser-test only: bounded phase metadata, never URLs, payloads or console text.
// A finished engine request proves transport only; Worker construction additionally
// proves the dynamic import evaluated. Neither alone proves Worker readiness.
export async function recordPdfLoadEvidence(context) {
  const events = [];
  const started = Date.now();
  const add = event => { events.push({ atMs: Date.now() - started, ...event }); if (events.length > 160) events.shift(); };
  const category = request => {
    const path = new URL(request.url()).pathname;
    if (/\/pdf$/.test(path) && request.method() === "GET") return "pdf-file";
    if (/\/assets\/pdf-[\w-]{8}\.js$/.test(path)) return "engine-module";
    if (/\/pdf\.worker-[^/]+\.mjs$/.test(path)) return "worker-module";
    return null;
  };
  const request = value => { const resource = category(value); if (resource) add({ resource, event: "requested" }); };
  const response = value => { const resource = category(value.request()); if (resource) add({ resource, event: "response", status: value.status(), serviceWorker: value.fromServiceWorker() }); };
  const finished = value => { const resource = category(value); if (resource) add({ resource, event: "finished" }); };
  const failed = value => { const resource = category(value); if (resource) add({ resource, event: "failed" }); };
  context.on("request", request);
  context.on("response", response);
  context.on("requestfinished", finished);
  context.on("requestfailed", failed);
  await context.exposeBinding("__samePagePdfEvidence", (_source, event, worker) => {
    // Copy only fixed vocabulary, even if a page calls the binding directly.
    if (["document", "worker-created", "worker-ready", "worker-configured", "document-requested", "worker-error", "worker-terminated"].includes(event)) add({ event, ...(Number.isSafeInteger(worker) && worker > 0 ? { worker } : {}) });
  });
  await context.addInitScript(() => {
    const record = (event, worker) => { void window.__samePagePdfEvidence(event, worker).catch(() => {}); };
    record("document");
    let nextWorker = 0;
    const OriginalWorker = window.Worker;
    window.Worker = class extends OriginalWorker {
      constructor(url, options) {
        super(url, options);
        const pdf = /\/pdf\.worker-[^/]+\.mjs$/.test(new URL(String(url), location.href).pathname);
        if (!pdf) return;
        const worker = ++nextWorker;
        record("worker-created", worker);
        this.addEventListener("message", event => { if (event.data?.action === "ready") record("worker-ready", worker); });
        this.addEventListener("error", () => record("worker-error", worker));
        const post = this.postMessage.bind(this);
        this.postMessage = (message, ...args) => {
          if (message?.action === "configure") record("worker-configured", worker);
          if (message?.action === "GetDocRequest") record("document-requested", worker);
          return post(message, ...args);
        };
        const terminate = this.terminate.bind(this);
        this.terminate = () => { record("worker-terminated", worker); return terminate(); };
      }
    };
  });
  return {
    events,
    dispose() {
      context.off("request", request);
      context.off("response", response);
      context.off("requestfinished", finished);
      context.off("requestfailed", failed);
    },
  };
}
