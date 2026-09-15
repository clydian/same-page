import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PDFDocumentProxy } from "./pdf-document";
import { ExportSession } from "./export-session";
import { authenticatedLocalOwnerKey, createLocalWorkspace, LocalWorkspaceOwnerChangedError } from "../platform/local-workspace";

const io = vi.hoisted(() => ({ read: vi.fn(), prepare: vi.fn(), generate: vi.fn(), hold: vi.fn(), refresh: () => {} }));
vi.mock("../annotations/annotation-state", () => ({ readScoreAnnotationState: io.read }));
vi.mock("./prepare-export", () => ({ prepareExport: io.prepare }));
vi.mock("./export-score", () => ({ exportScore: io.generate }));
vi.mock("../updates/update-safety", () => ({ holdUpdate: io.hold }));
vi.mock("dexie", async importOriginal => ({
  ...await importOriginal<typeof import("dexie")>(),
  liveQuery: (query: () => Promise<unknown>) => ({ subscribe(next: (value: unknown) => void) {
    let active = true;
    io.refresh = () => { void query().then(value => { if (active) next(value); }); };
    io.refresh();
    return { unsubscribe() { active = false; } };
  } }),
}));

const workspace = createLocalWorkspace(authenticatedLocalOwnerKey("reader"), "drive", "score");
const target = { workspace, versionId: "v1", fileName: "score.pdf", authenticatedUserId: "reader" };
const sessions: ExportSession[] = [];
function start() {
  const session = new ExportSession(target);
  sessions.push(session); session.start(); return session;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const state = { layers: [], annotations: [] };
const pdf = (snapshot: unknown = state) => ({ blob: new Blob(["pdf"]), snapshot: JSON.stringify(snapshot) });
const tick = () => vi.advanceTimersByTimeAsync(300);

beforeEach(() => {
  vi.useFakeTimers(); vi.resetAllMocks();
  io.read.mockResolvedValue(state);
  io.prepare.mockReturnValue({ promise: Promise.resolve({ source: {}, layers: [] }), destroy: vi.fn() });
  io.generate.mockResolvedValue(pdf());
  io.hold.mockImplementation(() => vi.fn());
});
afterEach(() => { sessions.splice(0).forEach(session => session.dispose()); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("invalidates a ready file immediately and coalesces rapid selection changes", async () => {
  const session = start(); await tick();
  expect(session.getSnapshot().file?.name).toBe("score.pdf");
  session.setIncludeNotes(false);
  expect(session.getSnapshot().file).toBeNull();
  session.setIncludeNotes(true); session.setIncludeNotes(false);
  await tick();
  expect(io.generate).toHaveBeenCalledTimes(2);
  expect(session.getSnapshot().file).not.toBeNull();
});

it("ignores a cancelled generation completing after its replacement, including its finally", async () => {
  const old = deferred<ReturnType<typeof pdf>>();
  const replacement = deferred<ReturnType<typeof pdf>>();
  io.generate.mockReturnValueOnce(old.promise).mockReturnValueOnce(replacement.promise);
  const session = start(); await tick();
  const signal = io.generate.mock.calls[0][5] as AbortSignal;
  session.setIncludeNotes(false); await tick();
  expect(signal.aborted).toBe(true);
  old.resolve(pdf()); await tick();
  expect(session.getSnapshot().file).toBeNull();
  expect(io.generate).toHaveBeenCalledTimes(2);
  replacement.resolve(pdf()); await tick();
  expect(session.getSnapshot().file).not.toBeNull();
});

it("keeps files unavailable while notes change during generation, then regenerates", async () => {
  const old = deferred<ReturnType<typeof pdf>>();
  io.generate.mockReturnValueOnce(old.promise);
  const session = start(); await tick();
  const changed = { layers: [], annotations: [{ id: "new-note" }] };
  io.read.mockResolvedValue(changed); io.refresh();
  await vi.advanceTimersByTimeAsync(0);
  old.resolve(pdf());
  io.generate.mockResolvedValue({ blob: new Blob(["new"]), snapshot: JSON.stringify(changed) });
  await tick();
  expect(io.generate).toHaveBeenCalledTimes(2);
  expect(await session.getSnapshot().file?.text()).toBe("new");
});

it("accepts the generation's fresh pull without starting a second generation", async () => {
  const pending = deferred<ReturnType<typeof pdf>>();
  io.generate.mockReturnValueOnce(pending.promise);
  const session = start(); await tick();
  const fresh = { layers: [], annotations: [] , revision: 2 };
  io.read.mockResolvedValue(fresh); io.refresh();
  await vi.advanceTimersByTimeAsync(0);
  pending.resolve({ blob: new Blob(["fresh"]), snapshot: JSON.stringify(fresh) });
  await tick();
  expect(session.getSnapshot().file).not.toBeNull();
  expect(io.generate).toHaveBeenCalledOnce();
});

it("invalidates ready output and refreshes layer choices when permission changes", async () => {
  const permitted = { layers: [{ id: "shared", kind: "shared", subscribed: true }], annotations: [] };
  io.prepare.mockReturnValueOnce({ promise: Promise.resolve({ source: {}, layers: permitted.layers }), destroy: vi.fn() });
  io.read.mockResolvedValue(permitted); io.generate.mockResolvedValue(pdf(permitted));
  const session = start(); await tick();
  expect(session.getSnapshot().selected).toEqual(["shared"]);
  const observations: ReturnType<ExportSession["getSnapshot"]>[] = [];
  const unsubscribe = session.subscribe(() => observations.push(session.getSnapshot()));
  io.read.mockResolvedValue(state); io.refresh(); await vi.advanceTimersByTimeAsync(0);
  unsubscribe();
  expect(observations.every(value => value.file === null)).toBe(true);
  expect(session.getSnapshot().file).toBeNull();
  expect(session.getSnapshot().layers).toEqual([]);
  expect(session.getSnapshot().selected).toEqual(["shared"]);
  session.removeUnavailableLayers();
  io.generate.mockResolvedValue(pdf()); await tick();
  expect(session.getSnapshot().selected).toEqual([]);
  expect(session.getSnapshot().file).not.toBeNull();
});

it("retries preparation and generation failures in the same session", async () => {
  const destroy = vi.fn();
  io.prepare.mockReturnValueOnce({ promise: Promise.reject(new Error("来源失败")), destroy });
  const session = start(); await tick();
  expect(session.getSnapshot().message).toBe("来源失败");
  io.generate.mockRejectedValueOnce(new Error("生成失败"));
  session.retry(); await tick();
  expect(destroy).toHaveBeenCalled();
  expect(session.getSnapshot().message).toBe("生成失败");
  session.retry(); await tick();
  expect(session.getSnapshot().file).not.toBeNull();
  expect(io.prepare).toHaveBeenCalledTimes(2);
});

it("disables an existing file on read failure and allows a fresh observed read", async () => {
  const session = start(); await tick();
  io.read.mockRejectedValue(new LocalWorkspaceOwnerChangedError()); io.refresh(); await tick();
  expect(session.getSnapshot().file).toBeNull();
  expect(session.getSnapshot().readError).toContain("登录状态已变化");
  io.read.mockResolvedValue(state); session.retry(); await tick();
  expect(session.getSnapshot().readError).toBeNull();
  expect(session.getSnapshot().file).not.toBeNull();
});

it("releases its preparation and update hold when closed before loading settles", async () => {
  const pending = deferred<{ source: object; layers: [] }>();
  const destroy = vi.fn();
  io.prepare.mockReturnValueOnce({ promise: pending.promise, destroy });
  const session = start(); await vi.advanceTimersByTimeAsync(0);
  const listener = vi.fn(); session.subscribe(listener);
  session.dispose();
  expect(destroy).toHaveBeenCalledOnce();
  expect(io.hold.mock.results[0].value).toHaveBeenCalled();
  pending.resolve({ source: {}, layers: [] }); await tick();
  expect(listener).not.toHaveBeenCalled();
  expect(io.generate).not.toHaveBeenCalled();
});

it("releases a cancelled generation hold without waiting for uncooperative work", async () => {
  io.generate.mockReturnValue(new Promise(() => {}));
  const session = start(); await tick();
  const release = io.hold.mock.results.at(-1)!.value;
  session.dispose();
  expect(release).toHaveBeenCalled();
  expect(io.generate.mock.calls[0][5].aborted).toBe(true);
});

it("does not prepare or destroy a borrowed reader document", async () => {
  const destroy = vi.fn();
  const source = { destroy };
  // The PDF reader is an external adapter; only its ownership is exercised here.
  const session = new ExportSession({ ...target, source: source as unknown as PDFDocumentProxy, layers: [] });
  sessions.push(session); session.start(); await tick(); session.dispose();
  expect(io.prepare).not.toHaveBeenCalled();
  expect(destroy).not.toHaveBeenCalled();
});

it("invokes system share synchronously, prevents duplicate presses, and preserves download fallback", async () => {
  const pending = deferred<void>();
  const share = vi.fn(() => pending.promise);
  vi.stubGlobal("navigator", { share });
  const session = start(); await tick();
  const sharing = session.share();
  expect(share).toHaveBeenCalledWith({ files: [session.getSnapshot().file] });
  void session.share(); expect(share).toHaveBeenCalledOnce();
  pending.reject(new Error("share unavailable")); await sharing;
  expect(session.getSnapshot()).toMatchObject({ sharing: false, shareFailed: true });
  expect(session.getSnapshot().file).not.toBeNull();
  share.mockRejectedValueOnce(new DOMException("cancel", "AbortError"));
  await session.share();
  expect(session.getSnapshot().message).toBeNull();
});

it("initializes library defaults from prepared layers rather than an earlier empty local read", async () => {
  const pending = deferred<{ source: object; layers: object[] }>();
  io.prepare.mockReturnValueOnce({ promise: pending.promise, destroy: vi.fn() });
  const session = start(); await tick();
  expect(session.getSnapshot().selected).toEqual([]);
  pending.resolve({ source: {}, layers: [{ id: "ensemble", kind: "shared", subscribed: true }] });
  await tick();
  expect(session.getSnapshot().selected).toEqual(["ensemble"]);
});

it("releases the native share hold on disposal and ignores its late settlement", async () => {
  const pending = deferred<void>();
  vi.stubGlobal("navigator", { share: vi.fn(() => pending.promise) });
  const session = start(); await tick();
  const sharing = session.share();
  const release = io.hold.mock.results.at(-1)!.value;
  const listener = vi.fn(); session.subscribe(listener);
  session.dispose();
  expect(release).toHaveBeenCalled();
  pending.resolve(); await sharing;
  expect(listener).not.toHaveBeenCalled();
});
