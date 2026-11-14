import { Blob as NodeBlob } from "node:buffer";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import * as storage from "../platform/local-database";
import { activateAuthenticatedLocalOwner, authenticatedLocalOwnerKey, createLocalWorkspace } from "../platform/local-workspace";
import { findVerifiedOfflineScore, sha256Hex } from "../offline/offline-score-verification";
import { revokeOfflinePreparationIdentity } from "../offline/offline-score";
import { clearReaderDocumentCache } from "../reader/reader-document-cache";
import { PreparedScoreLink } from "./prepared-score-link";
import { OfflineScoreControl } from "./offline-score-control";

// Only the PDF engine and browser network/route/shell are external. Opening, shared
// downloads, cancellation, hashing and offline activation run their real code.
const engine = vi.hoisted(() => ({ getDocument: vi.fn(), GlobalWorkerOptions: { workerSrc: "" } }));
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({ ...engine, PDFWorker: class { promise = Promise.resolve(); destroy() {} } }));
const connection = vi.hoisted(() => ({ recoverMedia: vi.fn(), getSnapshot: () => ({ active: "direct" }) }));
vi.mock("../connection/connection", () => ({ connections: connection, connectionsEnabled: true, connectionFetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args), connectionUrl: (path: string) => path }));
const bytes = new TextEncoder().encode("%PDF-1.7 shared fixture!");
const workspace = createLocalWorkspace(authenticatedLocalOwnerKey("user"), "drive", "score");
const score = { id: "score", choirId: "drive", fileName: "排练.pdf", updatedAt: 1,
  currentVersion: { id: "v1", versionNumber: 1, sizeBytes: bytes.byteLength, sha256: "", etag: "v1", pageCount: 1, createdAt: 1 } };
let finish: () => void, requestSignal: AbortSignal | null | undefined, requests: number, networkFailed: boolean, streamFailedOnce: boolean;
beforeEach(async () => {
  vi.stubGlobal("Blob", NodeBlob);
  vi.stubGlobal("navigator", { onLine: true, serviceWorker: { getRegistration: async () => ({ active: {} }) } });
  await storage.localDatabase.open(); await activateAuthenticatedLocalOwner("user");
  score.currentVersion.sha256 = await sha256Hex(bytes.buffer);
  requests = 0; networkFailed = false; streamFailedOnce = false; requestSignal = undefined;
  connection.recoverMedia.mockReset().mockResolvedValue(false);
  engine.getDocument.mockReset().mockImplementation(({ data }: { data: Uint8Array }) => {
    expect(Array.from(data)).toEqual(Array.from(bytes));
    return { promise: Promise.resolve({ numPages: 1 }), destroy: vi.fn().mockResolvedValue(undefined) };
  });
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    if (input.endsWith("/pdf")) {
      requests++; requestSignal = init?.signal;
      if (networkFailed) throw new TypeError("Failed to fetch");
      if (streamFailedOnce && requests === 1) return new Response(new ReadableStream({ start(controller) { controller.error(new TypeError("Failed to fetch")); } }));
      return new Response(new ReadableStream({ start(controller) {
        const half = Math.floor(bytes.length / 2);
        controller.enqueue(bytes.slice(0, half));
        finish = () => { controller.enqueue(bytes.slice(half)); controller.close(); };
      } }));
    }
    if (input.endsWith("/layers")) return Response.json({ layers: [{ id: "00000000-0000-4000-8000-000000000001", kind: "personal", sharedSlot: null, name: "我的笔记", sortOrder: 0, subscribed: true, subscriptionSource: "product", displayColor: "#a12652", colorSource: "product", adminDefaultColor: "#a12652", driveSubscribed: null, driveColorOverride: null, scoreSubscriptionOverride: null, canEdit: true }], sharedLayerRevision: 0, permissions: { canManageLayers: false } });
    if (input.includes("/annotations?")) return Response.json({ cursor: 0, objects: [] });
    return new Response(null, { status: 404 });
  }));
});
afterEach(() => { revokeOfflinePreparationIdentity("user"); clearReaderDocumentCache(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function Location() { return <div data-testid="location">{useLocation().pathname}</div>; }
function view() {
  return render(<MemoryRouter initialEntries={["/choirs/drive"]}>
    <PreparedScoreLink score={score} sessionId="session" userId="user" choirId="drive" scoreId="score" local={false} label="排练" description="PDF" onOpen={() => {}}>
      排练
    </PreparedScoreLink>
    <OfflineScoreControl score={score} authenticatedUserId="user" authenticatedSessionId="session" />
    <Location />
  </MemoryRouter>);
}
async function save() {
  const button = await screen.findByRole("button", { name: /^离线副本：/ });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button); fireEvent.click(screen.getByRole("button", { name: "保存供离线使用" }));
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
}
const open = () => fireEvent.click(screen.getByRole("link", { name: "排练" }));
const stays = () => expect(screen.getByTestId("location")).toHaveTextContent(/^\/choirs\/drive$/);

it.each(["open", "save"])("shares real bytes when %s starts first; cancelling open preserves explicit saving", async first => {
  view(); if (first === "open") open(); else await save();
  await waitFor(() => expect(requests).toBe(1));
  if (first === "open") await save(); else open();
  await waitFor(() => expect(screen.getAllByRole("progressbar", { name: "下载乐谱" })).toHaveLength(2));
  for (const progress of screen.getAllByRole("progressbar")) expect(progress).toHaveAttribute("value", "50");
  expect(engine.getDocument).not.toHaveBeenCalled(); stays();
  fireEvent.click(screen.getByRole("button", { name: /取消打开/ }));
  expect(requestSignal?.aborted).toBe(false);
  await act(async () => finish());
  await waitFor(async () => expect((await findVerifiedOfflineScore(workspace))?.versionId).toBe("v1"));
  expect(requests).toBe(1); expect(engine.getDocument).not.toHaveBeenCalled(); stays();
});

it("aborts the last open and never navigates on a late completion", async () => {
  view(); open(); await waitFor(() => expect(requests).toBe(1));
  fireEvent.click(screen.getByRole("button", { name: /取消打开/ }));
  expect(requestSignal?.aborted).toBe(true);
  await act(async () => finish()); stays(); expect(engine.getDocument).not.toHaveBeenCalled();
});

it("decodes only after the full download and reopens the retained document without another fetch", async () => {
  view(); open(); await waitFor(() => expect(requests).toBe(1));
  expect(engine.getDocument).not.toHaveBeenCalled();
  await act(async () => finish());
  await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/scores/score"));
  open(); await waitFor(() => expect(screen.queryByRole("button", { name: /取消打开/ })).not.toBeInTheDocument());
  expect(requests).toBe(1); expect(engine.getDocument).toHaveBeenCalledTimes(1);
});

it("keeps a network failure in the list and retries with a fresh download", async () => {
  networkFailed = true; view(); open();
  await screen.findByText("乐谱未能打开，请检查网络后重试。"); stays();
  networkFailed = false; open(); await waitFor(() => expect(requests).toBe(2));
  await act(async () => finish());
  await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/scores/score"));
});

it("opens online without an offline shell", async () => {
  navigator.serviceWorker.getRegistration = async () => undefined;
  view(); open(); await waitFor(() => expect(requests).toBe(1)); await act(async () => finish());
  await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/scores/score"));
  expect(await findVerifiedOfflineScore(workspace)).toBeNull();
});

it("preserves the reader's one-time route recovery when a connected PDF stream fails", async () => {
  streamFailedOnce = true; connection.recoverMedia.mockResolvedValueOnce(true);
  view(); open(); await waitFor(() => expect(requests).toBe(2));
  expect(connection.recoverMedia).toHaveBeenCalledTimes(1);
  expect(engine.getDocument).not.toHaveBeenCalled(); stays();
  await act(async () => finish());
  await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/scores/score"));
});

it("keeps online opening available when the shared explicit save hits quota", async () => {
  vi.spyOn(storage, "activateVerifiedOfflineScore").mockRejectedValue(new DOMException("Full", "QuotaExceededError"));
  view(); await save(); await waitFor(() => expect(requests).toBe(1)); open();
  await waitFor(() => expect(screen.getAllByRole("progressbar")).toHaveLength(2));
  await act(async () => finish());
  await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/scores/score"));
  fireEvent.click(screen.getByRole("button", { name: /^离线副本：/ }));
  await screen.findByRole("button", { name: "重试保存" });
  expect(storage.activateVerifiedOfflineScore).toHaveBeenCalled();
  expect(requests).toBe(1); expect(await findVerifiedOfflineScore(workspace)).toBeNull();
});

it("rejects mismatched bytes before decoding or certifying an offline copy", async () => {
  score.currentVersion.sha256 = "0".repeat(64); view(); await save();
  await waitFor(() => expect(requests).toBe(1)); open();
  await waitFor(() => expect(screen.getAllByRole("progressbar")).toHaveLength(2));
  await act(async () => finish());
  await screen.findByText("乐谱未能打开，请稍后重试。"); stays();
  expect(engine.getDocument).not.toHaveBeenCalled(); expect(await findVerifiedOfflineScore(workspace)).toBeNull();
});

it("revokes shared opening and explicit saving when the confirmed identity is lost", async () => {
  view(); await save(); await waitFor(() => expect(requests).toBe(1)); open();
  await waitFor(() => expect(screen.getAllByRole("progressbar")).toHaveLength(2));
  await act(async () => { revokeOfflinePreparationIdentity("user"); });
  expect(requestSignal?.aborted).toBe(true);
  await act(async () => finish()); stays();
  expect(engine.getDocument).not.toHaveBeenCalled(); expect(await findVerifiedOfflineScore(workspace)).toBeNull();
});
