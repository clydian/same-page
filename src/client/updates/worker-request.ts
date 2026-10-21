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
