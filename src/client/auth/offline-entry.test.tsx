import { slowIndexedDbTasks } from "../../test/slow-indexeddb-tasks";
import * as logoutFence from "./logout-fence";
import { cleanupAuthClient } from "../../test/cleanup-auth-client";
import { storeOfflineScore } from "../platform/local-database";
import { effectiveCapabilities, emptyPermissions } from "../../shared/drive-permissions";
import { Blob as NodeBlob } from "node:buffer";
import { sha256Hex } from "../offline/offline-score-verification";
import { LocalIdentityObserver } from "../platform/local-identity-observer";
import { clearPrivateLocalDataAfterLogout } from "./logout-local-data";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { AppRoutes } from "../app";
import { authClient } from "./auth-client";
import { localDatabase } from "../platform/local-database";
import { activateAuthenticatedLocalOwner, authenticatedLocalOwnerKey, createLocalWorkspace } from "../platform/local-workspace";
import { clearDriveLibraryCache } from "../score-library/drive-library-cache";

beforeEach(async () => {
  vi.stubGlobal("Blob", NodeBlob);
  await localDatabase.open();
  clearDriveLibraryCache();
  authClient.$store.atoms.session.set({ ...authClient.$store.atoms.session.get(), data: null, error: null, isPending: true, isRefetching: false });
});
afterEach(() => { cleanupAuthClient(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function saved(userId = "a") {
  await activateAuthenticatedLocalOwner(userId);
  const workspace = createLocalWorkspace(authenticatedLocalOwnerKey(userId), "drive", "score");
  const blob = new Blob(["verified test PDF"]);
  await localDatabase.driveDirectories.put({ key: JSON.stringify([workspace.ownerKey, "drive"]), ownerKey: workspace.ownerKey, choirId: "drive", choir: { id: "drive", name: "排练云盘", guestAdmissionMode: "invite" }, scores: [{ id: "score", choirId: "drive", fileName: `${userId}.pdf`, updatedAt: 1, currentVersion: { id: "version", versionNumber: 1, sizeBytes: blob.size, sha256: await sha256Hex(await blob.arrayBuffer()), etag: "v", pageCount: 1, createdAt: 1 } }], membership: true });
  await storeOfflineScore({ key: userId, ...workspace,
    versionId: "version", fileName: `${userId}.pdf`, sha256: await sha256Hex(await blob.arrayBuffer()), pageCount: 1, blob, active: 1, verifiedAt: 1,
    annotationSnapshot: { layers: [{ ...workspace, key: "personal", id: "00000000-0000-4000-8000-000000000001", kind: "personal", sharedSlot: null, name: "我的笔记", sortOrder: 0, subscribed: true, subscriptionSource: "personal", displayColor: "#000000", colorSource: "personal", adminDefaultColor: null, driveSubscribed: null, driveColorOverride: null, scoreSubscriptionOverride: null, canEdit: true }], annotations: [], cursor: 0, verifiedAt: 1 } });
}
function open(path = "/") {
  const view = render(<MemoryRouter initialEntries={[path]}><LocalIdentityObserver /><AppRoutes /></MemoryRouter>);
  act(() => { void authClient.$store.atoms.session.get().refetch(); });
  return view;
}

async function findSavedScoreLink() {
  // Directory hydration and verified opening are separate asynchronous phases.
  // Target the actual filename, not the offline-control description beside it.
  await screen.findByText(/^a$/, { selector: ".file-row__name" });
  return screen.findByRole("link", { name: /^a$/ });
}

it("offers the last local user's saved score after a cold-start network failure", async () => {
  await saved();
  slowIndexedDbTasks(40);
  vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
  open();
  expect(await findSavedScoreLink()).toHaveAttribute("href", "/choirs/drive/scores/score");
  await screen.findByText(/暂时无法连接/);
  expect(screen.queryByRole("heading", { name: "Harmony begins on the Same Page" })).not.toBeInTheDocument();
});

it.each(["valid", "corrupt"] as const)("keeps the directory entry unopenable until %s bytes finish verification", async kind => {
  await saved();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const readBytes = NodeBlob.prototype.arrayBuffer;
  const read = vi.spyOn(NodeBlob.prototype, "arrayBuffer").mockImplementation(async function(this: NodeBlob) {
    await gate;
    return kind === "valid" ? readBytes.call(this) : new ArrayBuffer(1);
  });
  vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
  open();
  try {
    const name = await screen.findByText(/^a$/, { selector: ".file-row__name" });
    await waitFor(() => expect(read).toHaveBeenCalled());
    expect(name.closest("[aria-disabled]")).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByRole("link", { name: /^a$/ })).not.toBeInTheDocument();
    await act(async () => { release(); await gate; });
    if (kind === "valid") {
      expect(await findSavedScoreLink()).toHaveAttribute("href", "/choirs/drive/scores/score");
    } else {
      await screen.findByTitle("此设备没有可用的离线副本");
      expect(screen.queryByRole("link", { name: /^a$/ })).not.toBeInTheDocument();
      expect(await localDatabase.offlineScores.get("a")).toBeDefined();
    }
  } finally {
    release();
  }
});

it("opens saved content at a drive deep link while authentication is still pending", async () => {
  await saved();
  let finish!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
  open("/choirs/drive");
  expect(await findSavedScoreLink()).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "登录或注册" })).not.toBeInTheDocument();
  await waitFor(() => expect(finish).toBeDefined());
  await act(async () => finish(Response.json(null)));
});

function authenticatedResponse(userId = "a") {
  return Response.json({ user: { id: userId, name: "Singer", email: "singer@example.test", emailVerified: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    session: { id: "test-session", userId, token: "test-only", expiresAt: new Date(Date.now() + 3600000).toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } });
}
const bootstrap = { choir: { id: "drive", name: "排练云盘", guestAdmissionMode: "invite" },
  scores: [{ id: "remote", choirId: "drive", fileName: "cloud.pdf", updatedAt: 1, currentVersion: { id: "v", versionNumber: 1, sizeBytes: 1, sha256: "sha", etag: "etag", pageCount: 1, createdAt: 1 } }],
  storage: { usedBytes: 1, limitBytes: 1000 }, permissions: { access: "membership", capabilities: effectiveCapabilities(true, emptyPermissions(), emptyPermissions()) } };
it("retains navigation metadata across a cold start without claiming cloud files are downloaded", async () => {
  await saved();
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("get-session")) return authenticatedResponse();
    if (url.endsWith("/bootstrap")) return Response.json(bootstrap);
    return Response.json({});
  }));
  const view = open("/choirs/drive");
  await screen.findByRole("link", { name: /^cloud$/ });
  await waitFor(() => expect(screen.getByRole("button", { name: "上传 PDF" })).toBeEnabled());
  view.unmount();
  clearDriveLibraryCache();
  vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
  authClient.$store.atoms.session.set({ ...authClient.$store.atoms.session.get(), data: null, isPending: true });
  open("/choirs/drive");
  await screen.findByText("cloud");
  expect(screen.queryByRole("link", { name: /^cloud$/ })).not.toBeInTheDocument();
  expect(screen.queryByText("需联网打开")).not.toBeInTheDocument();
  expect(screen.getByText("cloud").closest("[aria-disabled]")).toHaveAttribute("aria-disabled", "true");
  expect(screen.queryByRole("link", { name: /^a$/ })).not.toBeInTheDocument();
  expect(await localDatabase.offlineScores.get("a")).toBeDefined();
});

it.each([503, 401, 200])("keeps local files when cold-start authentication returns %s", async status => {
  await saved();
  vi.stubGlobal("fetch", vi.fn(async () => status === 200 ? Response.json(null) : Response.json({ message: "unavailable" }, { status })));
  open();
  await findSavedScoreLink();
  await screen.findByText(status === 503 ? /暂时无法连接/ : /重新登录后同步/);
  expect(screen.queryByRole("heading", { name: "Harmony begins on the Same Page" })).not.toBeInTheDocument();
});

it("rechecks the same user on reconnect and keeps the drive route", async () => {
  await saved();
  vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
  open("/choirs/drive");
  await screen.findByText(/暂时无法连接/);
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes("get-session")) return authenticatedResponse();
    if (String(input).endsWith("/bootstrap")) return Response.json(bootstrap);
    return Response.json({ memberships: [] });
  }));
  act(() => window.dispatchEvent(new Event("offline")));
  act(() => window.dispatchEvent(new Event("online")));
  await screen.findByRole("heading", { name: "排练云盘" });
  expect(await screen.findByRole("link", { name: /^cloud$/ }, { timeout: 4_000 })).toHaveAttribute("href", "/choirs/drive/scores/remote");
});

it("does not reveal the former user's saved list when another user authenticates", async () => {
  await saved();
  vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
  open();
  await findSavedScoreLink();
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).includes("get-session") ? authenticatedResponse("b") : Response.json({ memberships: [] })));
  await act(async () => { await authClient.$store.atoms.session.get().refetch(); });
  await screen.findByText(/本机尚未保存/);
  expect(screen.queryByText("a")).not.toBeInTheDocument();
  vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
  await act(async () => { await authClient.$store.atoms.session.get().refetch(); });
  await screen.findByText(/本机尚未保存/);
  expect(screen.queryByText("a")).not.toBeInTheDocument();
});

it("does not recover the previous user's directory after explicit local logout cleanup", async () => {
  await saved();
  await clearPrivateLocalDataAfterLogout();
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(null)));
  open();
  await screen.findByRole("heading", { name: "Harmony begins on the Same Page" });
  expect(screen.queryByText("a")).not.toBeInTheDocument();
});

it("the drive header recovers a failed session before reopening cloud-only scores", async () => {
  await saved();
  let unavailable = false;
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes("get-session")) {
      if (unavailable) throw new TypeError("Failed to fetch");
      return authenticatedResponse();
    }
    return Response.json(String(input).endsWith("/bootstrap") ? bootstrap : { memberships: [] });
  });
  vi.stubGlobal("fetch", fetch);
  open("/choirs/drive");
  await screen.findByRole("link", { name: /^cloud$/ });
  unavailable = true;
  await act(async () => { await authClient.$store.atoms.session.get().refetch(); });
  await screen.findByText(/暂时无法连接/);
  expect(screen.queryByRole("link", { name: /^cloud$/ })).not.toBeInTheDocument();
  unavailable = false;
  fireEvent.click(screen.getByRole("button", { name: "刷新乐谱列表" }));
  expect(await screen.findByRole("link", { name: /^cloud$/ })).toBeInTheDocument();
});

it("reports local acceptance failure after HTTP 200 without claiming a connection failure", async () => {
  await saved();
  vi.stubGlobal("fetch", vi.fn(async () => authenticatedResponse()));
  const accept = vi.spyOn(logoutFence, "acceptNewSession").mockRejectedValue(new DOMException("local failure", "UnknownError"));
  try {
    open("/choirs/drive");
    expect(await screen.findByText(/本机身份校验暂时未完成/)).toBeInTheDocument();
    expect(screen.queryByText(/暂时无法连接/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试校验" })).toBeVisible();
  } finally { accept.mockRestore(); }
});

it("recovers a transient session failure while remaining on the drive page", async () => {
  await saved();
  let unavailable = false;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes("get-session")) {
      if (unavailable) return Response.json({ message: "unavailable" }, { status: 503 });
      return authenticatedResponse();
    }
    return Response.json(String(input).endsWith("/bootstrap") ? bootstrap : { memberships: [] });
  }));
  open("/choirs/drive");
  await screen.findByRole("link", { name: /^cloud$/ });
  unavailable = true;
  await act(async () => { await authClient.$store.atoms.session.get().refetch(); });
  await screen.findByText(/暂时无法连接/);
  unavailable = false;
  expect(await screen.findByRole("link", { name: /^cloud$/ }, { timeout: 4_000 })).toBeInTheDocument();
});

it.each(["signed-out", "local-error", "hidden"] as const)("the real auth client's online event respects %s recovery boundaries", async state => {
  await saved();
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => state === "local-error" ? authenticatedResponse() : Response.json({ message: "unavailable" }, { status: state === "signed-out" ? 401 : 503 }));
  vi.stubGlobal("fetch", fetchMock);
  const accept = state === "local-error" ? vi.spyOn(logoutFence, "acceptNewSession").mockRejectedValue(new DOMException("local failure", "UnknownError")) : null;
  const visibility = state === "hidden" ? vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden") : null;
  try {
    open("/choirs/drive");
    await screen.findByText(state === "local-error" ? /本机身份校验暂时未完成/ : state === "signed-out" ? /重新登录后同步/ : /暂时无法连接/);
    const sessionCalls = () => fetchMock.mock.calls.filter(([input]) => String(input).includes("get-session")).length;
    const count = sessionCalls();
    act(() => window.dispatchEvent(new Event("offline")));
    act(() => window.dispatchEvent(new Event("online")));
    await act(() => new Promise(resolve => setTimeout(resolve, 100)));
    expect(sessionCalls()).toBe(count);
  } finally { accept?.mockRestore(); visibility?.mockRestore(); }
});
