import { ConnectionController } from "./controller";
import type { ConnectionMode } from "../../shared/connection";

import { configuredAssetReader, connectionOrigins, connectionsEnabledFor } from "../../shared/public-asset-fetch";
const { direct: primary, backup } = connectionOrigins;
export const connectionWebsites = { direct: primary, backup };
export const connectionsEnabled = typeof location !== "undefined" && connectionsEnabledFor(location.origin);
const modeKey = "same-page.connection-mode.v1", sessionKey = "same-page.connection-session.v1";
const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string | null) => { try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* Preferences cannot prevent access. */ } };
export const connections = new ConnectionController({
  origins: { direct: primary, backup }, pageOrigin: typeof location !== "undefined" ? location.origin : primary,
  send: (...args) => globalThis.fetch(...args), sessionId: connectionsEnabled ? read(sessionKey) : null,
  changedIdentity: id => write(sessionKey, id),
});
export function setConnectionMode(mode: ConnectionMode) { connections.setMode(mode); write(modeKey, mode); }
if (connectionsEnabled) {
  const mode = read(modeKey);
  if (mode === "direct" || mode === "backup") connections.setMode(mode);
  window.addEventListener("storage", event => {
    if (event.key === sessionKey) connections.invalidateIdentity(event.newValue);
    if (event.key === modeKey) connections.setMode(event.newValue === "direct" || event.newValue === "backup" ? event.newValue : "auto");
  });
}
export const connectionFetch: typeof fetch = (...args) => connectionsEnabled ? connections.fetch(...args) : globalThis.fetch(...args);
export const connectionUrl = (path: string) => connectionsEnabled ? connections.nativeEndpoint(path) : path;

export const readPublicAsset = configuredAssetReader(typeof location !== "undefined" ? location.origin : primary, () => connections.readRoutes());
