// Observe the browser directly: Workbox delays its waiting notification, so a
// fast manual handover can finish before its reload listener is attached.
export function watchControllerChanges(updated: () => void) {
  const workers = navigator.serviceWorker;
  if (!workers) return () => {};
  let previous = workers.controller;
  const changed = () => {
    const next = workers.controller;
    const replaced = previous && next && previous !== next;
    previous = next;
    if (replaced) updated();
  };
  workers.addEventListener("controllerchange", changed);
  return () => workers.removeEventListener("controllerchange", changed);
}

// Public shell metadata only. Legacy workers may ignore the message; a missing
// reply must not hang page restoration or be treated as permission to reload.
export function requestWorker(worker: ServiceWorker, message: object): Promise<unknown> {
  return new Promise(resolve => {
    let channel: MessageChannel;
    try { channel = new MessageChannel(); } catch { resolve(null); return; }
    const finish = (value: unknown) => { clearTimeout(timer); channel.port1.close(); resolve(value); };
    const timer = setTimeout(() => finish(null), 1500);
    channel.port1.onmessage = event => finish(event.data);
    try { worker.postMessage(message, [channel.port2]); }
    catch { finish(null); }
  });
}
