import type { HealthSample, RouteHealth } from './controller';

// Display evidence only: never mutate routing, identity or failure cooldowns.
// A newer observation wins; equally timed disagreement conservatively fails.
export function routeAvailability(health: RouteHealth, sample: HealthSample | undefined, now: number): 'available' | 'unavailable' | 'unknown' | 'stale' {
  const businessAt = health.state !== 'unknown' ? health.checkedAt : null;
  const latestAt = Math.max(businessAt ?? -Infinity, sample?.at ?? -Infinity);
  if (!Number.isFinite(latestAt)) return 'unknown';
  if (now - latestAt > 45_000) return 'stale';
  const failed = businessAt === latestAt && health.state === 'unreachable' || sample?.at === latestAt && sample.state === 'unreachable';
  return failed ? 'unavailable' : 'available';
}
