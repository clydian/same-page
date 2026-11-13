import { Blob as NodeBlob } from "node:buffer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  localDatabase,
  storeOfflineScore,
  type OfflineScoreRecord,
} from "../platform/local-database";
import * as workspaceModule from "../platform/local-workspace";
import { readRetainedScores } from "../offline/retained-scores";
import {
  findVerifiedOfflineScore,
  sha256Hex,
} from "../offline/offline-score-verification";
import { ReaderSession } from "./reader-session";
import { loadPdfDocument } from "./pdf-document";
import { clearReaderDocumentCache } from "./reader-document-cache";
vi.mock("./pdf-document", () => ({ loadPdfDocument: vi.fn() }));
beforeEach(async () => {
  vi.stubGlobal("Blob", NodeBlob);
  await localDatabase.open();
});
afterEach(() => {
  clearReaderDocumentCache();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function seed(id = "score") {
  const scope = await workspaceModule.resolveLocalWorkspace({
    authenticatedUserId: null,
    choirId: "diagnostic-drive",
    scoreId: id,
  });
  const blob = new Blob(["%PDF-1.7 local diagnostic fixture"]);
  const record: OfflineScoreRecord = {
    ...scope,
    key: scope.scopeKey + ":v1",
    versionId: "v1",
    fileName: id + ".pdf",
    sha256: await sha256Hex(await blob.arrayBuffer()),
    pageCount: 1,
    blob,
    active: 1,
    verifiedAt: 1,
    annotationSnapshot: {
      cursor: 0,
      verifiedAt: 1,
      annotations: [],
      layers: [
        {
          ...scope,
          key: scope.scopeKey + ":layer",
          id: "00000000-0000-4000-8000-000000000001",
          kind: "shared",
          sharedSlot: "E",
          name: "E",
          sortOrder: 0,
          subscribed: true,
          subscriptionSource: "product",
          displayColor: "#a12652",
          colorSource: "product",
          adminDefaultColor: "#a12652",
          driveSubscribed: null,
          driveColorOverride: null,
          scoreSubscriptionOverride: null,
          canEdit: false,
        },
      ],
    },
  };
  await storeOfflineScore(record);
  return scope;
}
it("keeps saved navigation entries on temporary Blob read failure without allowing unverified open", async () => {
  const scope = await seed("one");
  await seed("two");
  await seed("three");
  expect(await readRetainedScores(scope)).toHaveLength(3);
  const read = vi
    .spyOn(Blob.prototype, "arrayBuffer")
    .mockRejectedValue(
      new DOMException("temporary Blob storage read failure", "UnknownError"),
    );
  const listed = await readRetainedScores(scope);
  expect(read).not.toHaveBeenCalled();
  const files = await localDatabase.offlineScores.count(),
    snapshots = await localDatabase.offlineSnapshots.count();

  expect(listed).toHaveLength(3);
  await expect(findVerifiedOfflineScore(scope)).rejects.toThrow();
  expect(files).toBe(3);
  expect(snapshots).toBe(3);
  read.mockRestore();
  expect(await readRetainedScores(scope)).toHaveLength(3);
  expect(await findVerifiedOfflineScore(scope)).not.toBeNull();
});
it("cancelling during PDF-ready local checks retains files and snapshots", async () => {
  const scope = await seed();
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  let finish!: (value: unknown) => void;
  const pdf = new Promise((resolve) => {
    finish = resolve;
  });
  vi.mocked(loadPdfDocument).mockReturnValue({
    promise: pdf,
    destroy: vi.fn().mockResolvedValue(undefined),
  } as never);
  const original = workspaceModule.assertLocalWorkspaceActive;
  let block = false;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.spyOn(workspaceModule, "assertLocalWorkspaceActive").mockImplementation(
    async (w) => {
      if (block) await gate;
      return original(w);
    },
  );
  const session = new ReaderSession(scope, null);
  try {
    session.open();
    await vi.waitFor(() => expect(loadPdfDocument).toHaveBeenCalled());
    block = true;
    finish({
      versionId: "v1",
      document: { numPages: 1, destroy: async () => {} },
    });
    await vi.waitFor(() =>
      expect(session.getSnapshot().opening?.phase).toBe("local-check"),
    );
    expect(session.getSnapshot().status).toBe("loading");
    session.dispose();
    release();
    expect(await localDatabase.offlineScores.count()).toBe(1);
    expect(await localDatabase.offlineSnapshots.count()).toBe(1);
  } finally {
    release();
    session.dispose();
  }
});
it("bounds a PDF-ready local check at 15 foreground seconds and rejects its late completion", async () => {
  const scope = await seed();
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  let finish!: (value: unknown) => void;
  const pdf = new Promise((resolve) => {
    finish = resolve;
  });
  vi.mocked(loadPdfDocument).mockReturnValue({
    promise: pdf,
    destroy: vi.fn().mockResolvedValue(undefined),
  } as never);
  const original = workspaceModule.assertLocalWorkspaceActive;
  let block = false;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.spyOn(workspaceModule, "assertLocalWorkspaceActive").mockImplementation(
    async (w) => {
      if (block) await gate;
      return original(w);
    },
  );
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const session = new ReaderSession(scope, null);
  try {
    session.open();
    await vi.waitFor(() => expect(loadPdfDocument).toHaveBeenCalled());
    block = true;
    finish({
      versionId: "v1",
      document: { numPages: 1, destroy: async () => {} },
    });
    await vi.waitFor(() =>
      expect(session.getSnapshot().opening?.phase).toBe("local-check"),
    );
    await vi.advanceTimersByTimeAsync(15_000);
    expect(session.getSnapshot()).toMatchObject({
      status: "error",
      error: expect.stringContaining("暂时无法校验本机状态"),
    });
    expect(session.getSnapshot().error).toContain("已保存的乐谱和笔记仍然保留");
    const failed = session.getSnapshot();
    release();
    await Promise.resolve();
    await Promise.resolve();
    expect(session.getSnapshot()).toBe(failed);
    expect(await localDatabase.offlineScores.count()).toBe(1);
    expect(await localDatabase.offlineSnapshots.count()).toBe(1);
  } finally {
    release();
    session.dispose();
    vi.useRealTimers();
  }
});
it("does not retain another owner’s entries when local ownership changes", async () => {
  const scope = await seed();
  await workspaceModule.activateAuthenticatedLocalOwner("different-owner");
  await expect(readRetainedScores(scope)).rejects.toBeInstanceOf(
    workspaceModule.LocalWorkspaceOwnerChangedError,
  );
  expect(await localDatabase.offlineScores.count()).toBe(1);
});
