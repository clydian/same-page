import { afterEach, expect, it, vi } from "vitest";
import { watchControllerChanges } from "./worker-request";

afterEach(() => vi.restoreAllMocks());

it("observes a fast controller replacement without waiting for a library callback", () => {
  const workers = Object.assign(new EventTarget(), { controller: {} });
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: workers });
  const updated = vi.fn();
  const dispose = watchControllerChanges(updated);
  workers.controller = {};
  workers.dispatchEvent(new Event("controllerchange"));
  expect(updated).toHaveBeenCalledOnce();
  workers.dispatchEvent(new Event("controllerchange"));
  expect(updated).toHaveBeenCalledOnce();
  dispose(); workers.controller = {};
  workers.dispatchEvent(new Event("controllerchange"));
  expect(updated).toHaveBeenCalledOnce();
});

it("does not treat initial control as an update", () => {
  const workers = Object.assign(new EventTarget(), { controller: null as object | null });
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: workers });
  const updated = vi.fn();
  const dispose = watchControllerChanges(updated);
  workers.controller = {};
  workers.dispatchEvent(new Event("controllerchange"));
  expect(updated).not.toHaveBeenCalled();
  workers.controller = {};
  workers.dispatchEvent(new Event("controllerchange"));
  expect(updated).toHaveBeenCalledOnce();
  dispose();
});
