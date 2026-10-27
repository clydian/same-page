import { expect, it } from 'vitest';
import { routeAvailability } from './presentation';
import type { HealthSample, RouteHealth } from './controller';

const health = (state: RouteHealth['state'], checkedAt: number | null): RouteHealth => ({ state, checkedAt, latency: null });
const sample = (state: HealthSample['state'], at: number): HealthSample => ({ state, at, latency: null });
it.each([
  [health('unreachable', 2000), sample('reachable', 3000), 'available'],
  [health('unreachable', 3000), sample('reachable', 2000), 'unavailable'],
  [health('reachable', 2000), sample('unreachable', 3000), 'unavailable'],
  [health('reachable', 3000), sample('unreachable', 2000), 'available'],
  [health('unreachable', 3000), sample('reachable', 3000), 'unavailable'],
  [health('reachable', 3000), sample('unreachable', 3000), 'unavailable'],
  [health('reachable', 3000), sample('reachable', 3000), 'available'],
  [health('unknown', null), undefined, 'unknown'],
  [health('unknown', null), sample('reachable', 3000), 'available'],
  [health('unreachable', 3000), undefined, 'unavailable'],
] as const)('arbitrates current-route display evidence %#', (business, probe, expected) => {
  expect(routeAvailability(business, probe, 4000)).toBe(expected);
});
it.each(['reachable', 'unreachable'] as const)('expires old %s evidence without converting it into a fresh result', state => {
  const business = health(state, 2000), probe = sample(state, 3000);
  expect(routeAvailability(business, probe, 48_000)).toBe(state === 'reachable' ? 'available' : 'unavailable');
  expect(routeAvailability(business, probe, 48_001)).toBe('stale');
});
