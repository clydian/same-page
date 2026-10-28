import { publicAssetReader } from './read-transport';
import type { ConnectionRoute } from './connection';

declare const __SAME_PAGE_CONNECTIONS__: { enabled: boolean; origins: Record<ConnectionRoute, string> };
const configuration = typeof __SAME_PAGE_CONNECTIONS__ === 'object' ? __SAME_PAGE_CONNECTIONS__ : {
  enabled: false,
  origins: { direct: 'https://samepage.clyapps.com', backup: 'https://samepage-alt.clyapps.com' },
};
export const connectionOrigins = configuration.origins;
export const connectionsEnabledFor = (origin: string) => configuration.enabled && Object.values(connectionOrigins).includes(origin);
export function configuredAssetReader(origin: string, routes?: () => ConnectionRoute[]) {
  return publicAssetReader({ origin, ...(connectionsEnabledFor(origin) ? { origins: connectionOrigins, routes } : {}) });
}
