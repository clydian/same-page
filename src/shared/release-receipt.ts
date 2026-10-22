import type { ReleaseTarget, ReleaseChannel } from "./release-channels";
export interface ReleaseReceipt {
  pending?: { channel: ReleaseChannel; intent: string };
  confirmed?: ReleaseTarget;
  permitted?: ReleaseTarget;
}
export const releaseSelectionLock = "same-page-release-selection";
const cacheName = (origin: string) => "same-page-release-permission-v1:" + encodeURIComponent(origin);
const key = (origin: string) => new URL("/__same_page_release_permission__", origin).href;
export async function readReleaseReceipt(origin: string): Promise<ReleaseReceipt> {
  const response = await (await caches.open(cacheName(origin))).match(key(origin));
  return response ? await response.json() as ReleaseReceipt : {};
}
export async function writeReleaseReceipt(origin: string, receipt: ReleaseReceipt) {
  await (await caches.open(cacheName(origin))).put(key(origin), Response.json(receipt));
}
