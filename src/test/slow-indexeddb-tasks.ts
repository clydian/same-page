import { vi } from "vitest";

// fake-indexeddb schedules transactions via globalThis.setImmediate. Preserve
// macrotask semantics while making cold-start readiness span multiple turns.
// Call after seeding fixtures; restore with vi.unstubAllGlobals in afterEach.
export function slowIndexedDbTasks(delayMs: number) {
  vi.stubGlobal("setImmediate", (callback: (...args: unknown[]) => void, ...args: unknown[]) =>
    setTimeout(callback, delayMs, ...args));
}
