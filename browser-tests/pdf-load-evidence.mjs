// Browser-test only: bounded phase metadata, never URLs, payloads or console text.
// A finished engine request proves transport only; Worker construction additionally
// proves the dynamic import evaluated. Neither alone proves Worker readiness.
const workerMessages = {
  ready: "worker-ready",
  GetReader: "pdf-reader-requested",
  DataLoaded: "pdf-bytes-loaded",
  GetDoc: "document-opened",
  DocException: "document-error",
  StartRenderPage: "page-render-started",
};

export async function recordPdfLoadEvidence(context) {
  const events = [];
  const started = performance.now();
  const add = event => { events.push({ atMs: Math.round(performance.now() - started), ...event }); if (events.length > 160) events.shift(); };
  const mark = event => add({ event });
  const category = request => {
    const path = new URL(request.url()).pathname;
    if (/\/pdf$/.test(path) && request.method() === "GET") return "pdf-file";
    if (/\/pdf$/.test(path) && request.method() === "HEAD") return "pdf-head";
    if (/\/assets\/pdf-[\w-]{8}\.js$/.test(path)) return "engine-module";
    if (/\/pdf\.worker-[^/]+\.mjs$/.test(path)) return "worker-module";
    return null;
  };
  const requestIds = new WeakMap();
  let nextRequest = 0;
  const recordRequest = (value, event, details) => {
    const resource = category(value);
    if (!resource) return;
    if (!requestIds.has(value)) requestIds.set(value, ++nextRequest);
    add({ resource, request: requestIds.get(value), event, ...details });
  };
  const request = value => recordRequest(value, "requested");
  const response = value => recordRequest(value.request(), "response", { status: value.status(), serviceWorker: value.fromServiceWorker() });
  const finished = value => recordRequest(value, "finished");
  const failed = value => recordRequest(value, "failed", { aborted: value.failure()?.errorText === "net::ERR_ABORTED" });
  context.on("request", request);
  context.on("response", response);
  context.on("requestfinished", finished);
  context.on("requestfailed", failed);
  const browserEvents = new Set(["document", "worker-created", "worker-configured", "document-requested", "document-transport-ready",
    "worker-error", "worker-terminated", ...Object.values(workerMessages)]);
  await context.exposeBinding("__samePagePdfEvidence", (_source, event, worker) => {
    // Copy only fixed vocabulary, even if a page calls the binding directly.
    if (browserEvents.has(event)) add({ event, ...(Number.isSafeInteger(worker) && worker > 0 ? { worker } : {}) });
  });
  await context.addInitScript(messages => {
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
        this.addEventListener("message", event => {
          const action = event.data?.action;
          if (typeof action === "string" && Object.hasOwn(messages, action)) record(messages[action], worker);
        });
        this.addEventListener("error", () => record("worker-error", worker));
        const post = this.postMessage.bind(this);
        this.postMessage = (message, ...args) => {
          if (message?.action === "configure") record("worker-configured", worker);
          if (message?.action === "GetDocRequest") record("document-requested", worker);
          if (message?.action === "Ready") record("document-transport-ready", worker);
          return post(message, ...args);
        };
        const terminate = this.terminate.bind(this);
        this.terminate = () => { record("worker-terminated", worker); return terminate(); };
      }
    };
  }, workerMessages);
  return {
    events,
    mark,
    dispose() {
      context.off("request", request);
      context.off("response", response);
      context.off("requestfinished", finished);
      context.off("requestfailed", failed);
    },
  };
}
