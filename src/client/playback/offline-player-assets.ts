import { buildId } from '../../shared/build';

// Since the complete player is a required release dependency, the worker owns
// its installation, repair, integrity audit and retirement together with the PDF
// shell. Never make a second public bundle or download resources from the page.
async function shellReady(signal?: AbortSignal) {
  signal?.throwIfAborted();
  const registration = await navigator.serviceWorker?.getRegistration();
  signal?.throwIfAborted();
  if (!registration?.active) return false;
  return new Promise<boolean>(resolve => {
    const channel = new MessageChannel();
    const finish = (ready: boolean) => { clearTimeout(timeout); signal?.removeEventListener('abort', aborted); channel.port1.close(); resolve(ready); };
    const aborted = () => finish(false);
    const timeout = setTimeout(() => finish(false), 20_000);
    channel.port1.onmessage = event => finish(event.data?.buildId === buildId);
    signal?.addEventListener('abort', aborted, { once: true });
    if (signal?.aborted) { aborted(); return; }
    try { registration.active!.postMessage({ type: 'SAME_PAGE_PLAYBACK_READY', buildId }, [channel.port2]); }
    catch { finish(false); }
  });
}

export async function offlinePlayerAssetsReady() {
  try { return await shellReady(); }
  catch { return false; }
}
export async function prepareOfflinePlayerAssets(signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  if (!await shellReady(signal)) {
    signal?.throwIfAborted();
    throw new Error('playback_assets_incomplete');
  }
  signal?.throwIfAborted();
}
