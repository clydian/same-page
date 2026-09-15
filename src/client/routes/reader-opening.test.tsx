import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { noCapabilities } from "../../shared/drive-permissions";
import { localDatabase } from "../platform/local-database";
import { activateAuthenticatedLocalOwner } from "../platform/local-workspace";
import { NavigationProvider } from "../navigation/navigation";
import { loadPdfDocument, type PDFDocumentProxy, type PdfLoadProgress } from "../reader/pdf-document";
import { clearReaderDocumentCache } from "../reader/reader-document-cache";
import { clearReaderScoreCache } from "../reader/reader-score-cache";
import ReaderPage from "./reader-page";

// Control the external engine, not the route's decision to retire loading.
vi.mock("../reader/pdf-document", () => ({ loadPdfDocument: vi.fn() }));
vi.mock("../auth/auth-client", () => ({ authClient: {
  useSession: () => ({ data: { user: { id: "opening-user" } }, isPending: false }),
} }));
afterEach(() => {
  clearReaderDocumentCache();
  clearReaderScoreCache();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("displays engine progress and keeps loading through complete transfer until the current canvas paints", async () => {
  await localDatabase.open();
  await activateAuthenticatedLocalOwner("opening-user");
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as CanvasRenderingContext2D);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("fetch", vi.fn(async (input: string) => (input.includes("/sync") || input.endsWith("/scores/score"))
    ? Response.json({ state: "active", layers: { layers: [{
        id: "00000000-0000-4000-8000-000000000001", kind: "personal", sharedSlot: null, name: "我的笔记",
        sortOrder: 0, subscribed: true, subscriptionSource: "personal", displayColor: "#a12652", colorSource: "product",
        adminDefaultColor: "#a12652", driveSubscribed: null, driveColorOverride: null, scoreSubscriptionOverride: null, canEdit: true,
      }], sharedLayerRevision: 0, permissions: { canManageLayers: false } },
      annotations: { cursor: 0, objects: [] }, permissions: { capabilities: noCapabilities() }, score: {
        id: "score", choirId: "opening", fileName: "谱.pdf", updatedAt: 1,
        currentVersion: { id: "v1", versionNumber: 1, sizeBytes: 1000, sha256: "a".repeat(64), etag: "v1", pageCount: 1, createdAt: 1 },
      } }) : new Response(null, { status: 503 })));
  let report!: (progress: PdfLoadProgress) => void;
  let finishDocument!: (value: { document: PDFDocumentProxy; versionId: string }) => void;
  let finishPaint!: () => void;
  const renderPage = vi.fn(() => ({ promise: new Promise<void>(resolve => { finishPaint = resolve; }), cancel: vi.fn() }));
  const pdf = { numPages: 1, getPage: vi.fn().mockResolvedValue({
    getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }), render: renderPage,
  }) } as unknown as PDFDocumentProxy;
  vi.mocked(loadPdfDocument).mockImplementation((_source, _version, onProgress) => {
    report = onProgress!;
    return { promise: new Promise(resolve => { finishDocument = resolve; }), destroy: vi.fn().mockResolvedValue(undefined) };
  });
  render(<MemoryRouter initialEntries={["/choirs/opening/scores/score"]}><NavigationProvider><Routes>
    <Route path="/choirs/:choirId/scores/:scoreId" element={<ReaderPage />} />
  </Routes></NavigationProvider></MemoryRouter>);
  await waitFor(() => expect(report).toBeDefined());
  act(() => report({ phase: "file", loadedBytes: 123, totalBytes: null }));
  expect(screen.getByRole("progressbar", { name: "PDF 文件加载进度" })).not.toHaveAttribute("value");
  expect(screen.getByText(/已获取$/)).toBeVisible();
  act(() => report({ phase: "file", loadedBytes: 500, totalBytes: 1000 }));
  expect(screen.getByRole("progressbar")).toHaveAttribute("value", "500");
  expect(screen.getByRole("progressbar")).toHaveAttribute("max", "1000");
  act(() => report({ phase: "document", loadedBytes: 1000, totalBytes: 1000 }));
  expect(screen.getByRole("main", { name: "正在加载乐谱" })).toBeVisible();
  expect(screen.getByRole("progressbar")).toHaveAttribute("value", "1000");
  await act(async () => finishDocument({ document: pdf, versionId: "v1" }));
  await waitFor(() => expect(renderPage).toHaveBeenCalled());
  expect(screen.getByRole("main", { name: "正在加载乐谱" })).toBeVisible();
  await act(async () => finishPaint());
  await waitFor(() => expect(screen.queryByRole("main", { name: "正在加载乐谱" })).not.toBeInTheDocument());
  expect(screen.getByRole("img", { name: "第 1 页" })).toBeVisible();
});
