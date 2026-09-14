import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { ReaderSession } from "./reader-session";
import { localDatabase } from "../platform/local-database";
import * as workspaceModule from "../platform/local-workspace";
import { loadPdfDocument } from "./pdf-document";
import { clearReaderDocumentCache } from "./reader-document-cache";
import { clearDiagnostics, exportDiagnostics } from "../diagnostics/diagnostics";

vi.mock("./pdf-document", () => ({ loadPdfDocument: vi.fn() }));
beforeEach(async () => { await localDatabase.open(); clearDiagnostics(); });
afterEach(() => { clearReaderDocumentCache(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

// Exercise the same reader-document timeout through two distinct blockers.
it.each(["document-stalled", "local-validation-stalled"])("timeout preserves the actual opening phase: %s", async mode => {
  const workspace = await workspaceModule.resolveLocalWorkspace({ authenticatedUserId: null, choirId: "diagnostic-drive", scoreId: "score" });
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
  let documentLoaded = false;
  vi.mocked(loadPdfDocument).mockImplementation(() => ({
    promise: mode === "document-stalled" ? new Promise(() => {}) : Promise.resolve().then(() => {
      documentLoaded = true;
      return { document: { numPages: 1 }, versionId: "version" } as Awaited<ReturnType<typeof loadPdfDocument>["promise"]>;
    }), destroy: vi.fn().mockResolvedValue(undefined),
  }));
  const original = workspaceModule.assertLocalWorkspaceActive;
  vi.spyOn(workspaceModule, "assertLocalWorkspaceActive").mockImplementation((value) => documentLoaded ? new Promise(() => {}) : original(value));
  vi.useFakeTimers();
  const session = new ReaderSession(workspace, null);
  try {
    session.open();
    await vi.advanceTimersByTimeAsync(45_000);
    const records = JSON.parse(exportDiagnostics()).records;
    expect(session.getSnapshot().error).toBe("加载用时较长，可以重试或返回云盘。这不代表设备不兼容。");
    expect(records).toEqual([expect.objectContaining({ operation: "pdf", category: "internal", stage: "prepare", step: "reader-document", opening: expect.objectContaining({ phase: mode === "document-stalled" ? "engine" : "local-check", source: "cloud" }), errorType: "TimeoutError", pdfReason: "timeout", requestId: null })]);
  } finally { session.dispose(); vi.useRealTimers(); }
});

it("restores the completed opening facts when a replacement fails and the previous page remains visible", async () => {
  const { noCapabilities } = await import("../../shared/drive-permissions");
  const workspace = await workspaceModule.resolveLocalWorkspace({ authenticatedUserId: null, choirId: "restore-drive", scoreId: "score" });
  let version = "v1";
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ state: "active", layers: { layers: [], sharedLayerRevision: 0, permissions: { canManageLayers: false } }, annotations: { cursor: 0, objects: [] }, permissions: { capabilities: noCapabilities() }, score: { id: "score", choirId: "restore-drive", fileName: "score.pdf", updatedAt: 1, currentVersion: { id: version, versionNumber: 1, sizeBytes: 10, sha256: "a".repeat(64), etag: "test", pageCount: 1, createdAt: 1 } } })));
  const document = { numPages: 1 } as Awaited<ReturnType<typeof loadPdfDocument>["promise"]>["document"];
  vi.mocked(loadPdfDocument).mockImplementation((_source, expected) => ({ promise: expected === "v2" ? Promise.reject(new Error("replacement failed")) : Promise.resolve({ document, versionId: "v1" }), destroy: vi.fn().mockResolvedValue(undefined) }));
  const session = new ReaderSession(workspace, null);
  try {
    session.open();
    await vi.waitFor(() => expect(session.getSnapshot()).toMatchObject({ status: "ready", cloudState: "active", document }));
    session.presentation.select({ document, page: 1, editing: false });
    session.presentation.ready(document, 1);
    const completed = session.getSnapshot().opening;
    expect(completed?.phase).toBe("ready");
    version = "v2";
    await session.refresh();
    await vi.waitFor(() => expect(session.getSnapshot().displayMessage).toContain("已保留原谱面"));
    expect(session.getSnapshot().opening).toEqual(completed);
  } finally { session.dispose(); }
});
