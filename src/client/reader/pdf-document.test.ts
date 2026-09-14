import { afterEach, expect, it, vi } from "vitest";
import { loadPdfDocument } from "./pdf-document";

const engine = vi.hoisted(() => ({ getDocument: vi.fn(), workerReady: Promise.resolve(), destroyWorker: vi.fn(), GlobalWorkerOptions: { workerSrc: "" } }));
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({ ...engine, PDFWorker: class {
  promise = engine.workerReady;
  destroy = engine.destroyWorker;
} }));
afterEach(() => { vi.restoreAllMocks(); engine.workerReady = Promise.resolve(); engine.getDocument.mockClear(); engine.destroyWorker.mockClear(); });

it("forwards actual PDF.js progress, leaves unknown totals indeterminate and stops after document readiness", async () => {
  let finish!: (document: { numPages: number }) => void;
  const promise = new Promise<{ numPages: number }>(resolve => { finish = resolve; });
  const task = { promise, destroy: vi.fn().mockResolvedValue(undefined), onProgress: vi.fn<(value: { loaded: number; total: number }) => void>() };
  engine.getDocument.mockReturnValue(task);
  const progress = vi.fn();
  const load = loadPdfDocument("/versions/v1/pdf", "v1", progress);
  await vi.waitFor(() => expect(engine.getDocument).toHaveBeenCalled());
  expect(engine.getDocument).toHaveBeenCalledWith(expect.objectContaining({ url: "/versions/v1/pdf", rangeChunkSize: 65_536, withCredentials: true }));
  task.onProgress({ loaded: 123, total: NaN });
  expect(progress).toHaveBeenLastCalledWith({ phase: "file", loadedBytes: 123, totalBytes: null });
  task.onProgress({ loaded: 500, total: 1000 });
  expect(progress).toHaveBeenLastCalledWith({ phase: "file", loadedBytes: 500, totalBytes: 1000 });
  task.onProgress({ loaded: 1000, total: 1000 });
  expect(progress).toHaveBeenLastCalledWith({ phase: "document", loadedBytes: 1000, totalBytes: 1000 });
  finish({ numPages: 1 });
  await load.promise;
  const count = progress.mock.calls.length;
  task.onProgress({ loaded: 2000, total: 2000 });
  expect(progress).toHaveBeenCalledTimes(count);
  await load.destroy();
});

it("destroying a task prevents late PDF progress from publishing", async () => {
  const late = vi.fn();
  const task = { promise: new Promise(() => {}), destroy: vi.fn().mockResolvedValue(undefined), onProgress: late };
  engine.getDocument.mockReturnValue(task);
  const progress = vi.fn();
  const load = loadPdfDocument("/versions/v2/pdf", "v2", progress);
  await vi.waitFor(() => expect(task.onProgress).not.toBe(late));
  await load.destroy();
  const count = progress.mock.calls.length;
  task.onProgress({ loaded: 1, total: 2 });
  expect(progress).toHaveBeenCalledTimes(count);
});

it("keeps a stalled PDF Worker in preparation until it is actually ready", async () => {
  let ready!: () => void;
  engine.workerReady = new Promise<void>(resolve => { ready = resolve; });
  engine.getDocument.mockReturnValue({ promise: new Promise(() => {}), destroy: vi.fn().mockResolvedValue(undefined) });
  const progress = vi.fn();
  const load = loadPdfDocument("/versions/stalled/pdf", "stalled", progress);
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(engine.getDocument).not.toHaveBeenCalled();
  expect(progress).toHaveBeenLastCalledWith({ phase: "engine", loadedBytes: null, totalBytes: null });
  ready();
  await vi.waitFor(() => expect(engine.getDocument).toHaveBeenCalledTimes(1));
  expect(progress).toHaveBeenLastCalledWith({ phase: "file", loadedBytes: 0, totalBytes: null });
  await load.destroy();
  expect(engine.destroyWorker).toHaveBeenCalledTimes(1);
});

it("cancels during worker preparation without starting a late PDF request", async () => {
  let ready!: () => void;
  engine.workerReady = new Promise<void>(resolve => { ready = resolve; });
  const progress = vi.fn();
  const load = loadPdfDocument("/versions/cancelled/pdf", "cancelled", progress);
  await new Promise(resolve => setTimeout(resolve, 20));
  const cancelled = expect(load.promise).rejects.toMatchObject({ name: "AbortError" });
  await load.destroy();
  const count = progress.mock.calls.length;
  ready();
  await cancelled;
  expect(engine.getDocument).not.toHaveBeenCalled();
  expect(progress).toHaveBeenCalledTimes(count);
  expect(engine.destroyWorker).toHaveBeenCalledTimes(1);
});
