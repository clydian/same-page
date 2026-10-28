import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { connections } from "../connection/connection";
import { noCapabilities } from "../../shared/drive-permissions";
import { resetNavigation } from "../settings/navigation-events";
import { useDriveLibraryResource } from "./use-drive-library";

vi.mock("../connection/connection", async importOriginal => {
  const actual = await importOriginal<typeof import("../connection/connection")>();
  const { ConnectionController } = await import("../connection/controller");
  const connections = new ConnectionController({
    origins: { direct: "https://direct.test", backup: "https://backup.test" },
    pageOrigin: window.location.origin,
    sessionId: "session-one",
    send: (...args) => globalThis.fetch(...args),
  });
  return { ...actual, connections, connectionsEnabled: true, connectionFetch: (...args: Parameters<typeof fetch>) => connections.fetch(...args) };
});

// The global test setup imports diagnostics before this file's connection
// configuration. Keep its real wrapper while using this test's controller.
vi.mock("../diagnostics/diagnostics", async importOriginal => {
  const actual = await importOriginal<typeof import("../diagnostics/diagnostics")>();
  const { connections } = await import("../connection/connection");
  return { ...actual, diagnosticFetch: (input: RequestInfo | URL, init?: RequestInit) =>
    actual.diagnosticRequest(input, init, () => connections.fetch(input, init)) };
});

const reads: Array<{ signal: AbortSignal | null | undefined; route: string; finish: (response: Response) => void }> = [];
let entrySession = "session-one";
function payload(name: string) {
  return Response.json({ choir: { id: "drive", name, guestAdmissionMode: "open" }, scores: [],
    storage: { usedBytes: 0, limitBytes: 1000 }, permissions: { capabilities: noCapabilities(), access: "membership" } });
}
function Library({ ready = true }: { ready?: boolean }) {
  const { library, snapshot } = useDriveLibraryResource("user:one", "drive", true, ready, "session-one");
  const access = snapshot.access;
  return <>
    <p>{access.kind === "join-required" ? `加入${access.choir.name}` : access.kind === "opened" && !access.local ? access.choir.name : "未确认云端权限"}</p>
    <input aria-label="搜索" value={snapshot.view.search} onChange={event => library.setSearch(event.target.value)} />
  </>;
}

beforeEach(() => {
  resetNavigation();
  reads.length = 0;
  entrySession = "session-one";
  connections.invalidateIdentity("session-one");
  connections.setMode("direct");
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/connection/status")) return Response.json({ sessionId: entrySession });
    if (url.pathname.endsWith("/health")) return Response.json({ status: "ok" });
    if (url.pathname.endsWith("/guest/choirs/drive")) return Response.json({
      choir: { id: "drive", name: "开放云盘", guestAdmissionMode: "open" }, entryKind: "admission",
    });
    if (url.pathname.endsWith("/bootstrap")) return new Promise<Response>(finish => reads.push({ signal: init?.signal, route: url.hostname, finish }));
    throw new Error("Unexpected request in library recovery test");
  }));
});

it("preserves first-visit open admission when a route change interrupts the initial bootstrap", async () => {
  render(<Library />);
  await waitFor(() => expect(reads).toHaveLength(1));
  act(() => connections.setMode("backup"));
  await waitFor(() => expect(reads).toHaveLength(2));
  await act(async () => reads[1].finish(Response.json({ error: "forbidden" }, { status: 403 })));
  await screen.findByText("加入开放云盘");
  expect(vi.mocked(fetch).mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
});
afterEach(async () => {
  resetNavigation();
  await act(async () => { reads.forEach(read => read.finish(payload("已失效"))); });
  vi.unstubAllGlobals();
});

it("replaces a pending read on mode changes and fences late responses without losing the view", async () => {
  render(<Library />);
  await waitFor(() => expect(reads).toHaveLength(1));
  fireEvent.change(screen.getByRole("textbox", { name: "搜索" }), { target: { value: "秋日" } });
  act(() => connections.setMode("backup"));
  await waitFor(() => expect(reads).toHaveLength(2));
  expect(reads[0].signal?.aborted).toBe(true);
  expect(reads[1].route).toBe("backup.test");
  await act(async () => reads[1].finish(payload("备用线路已确认")));
  await screen.findByText("备用线路已确认");
  await act(async () => reads[0].finish(payload("过期直连响应")));
  expect(screen.queryByText("过期直连响应")).not.toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "搜索" })).toHaveValue("秋日");
  // Changing the preference while the effective entry stays the same also
  // invalidates the controller generation and requires a fresh confirmation.
  act(() => connections.setMode("auto"));
  await waitFor(() => expect(reads).toHaveLength(3));
  await act(async () => reads[2].finish(payload("自动线路已确认")));
  await screen.findByText("自动线路已确认");
});

it("settles automatic failover without turning health updates into a refresh loop", async () => {
  const bootstrapRoutes: string[] = [];
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/connection/status")) return Response.json({ sessionId: "session-one" });
    if (url.pathname.endsWith("/health")) return Response.json({ status: "ok" });
    bootstrapRoutes.push(url.hostname);
    if (url.hostname === "direct.test") throw new TypeError("Failed to fetch");
    return payload("自动备用线路已确认");
  }));
  connections.setMode("auto");
  render(<Library />);
  await screen.findByText("自动备用线路已确认");
  await act(async () => {});
  expect(connections.getSnapshot().active).toBe("backup");
  expect(bootstrapRoutes).toEqual(["direct.test", "backup.test", "backup.test"]);
  expect(vi.mocked(fetch).mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
});

it("does not reload for health or identity notifications, or after the view unmounts", async () => {
  const view = render(<Library />);
  await waitFor(() => expect(reads).toHaveLength(1));
  await act(async () => reads[0].finish(payload("云端已确认")));
  await screen.findByText("云端已确认");
  await act(async () => connections.check());
  expect(reads).toHaveLength(1);
  act(() => connections.invalidateIdentity("session-two"));
  expect(reads).toHaveLength(1);
  view.unmount();
  act(() => connections.setMode("backup"));
  await act(async () => {});
  expect(reads).toHaveLength(1);
});

it("keeps a mismatched entry from granting cloud access and waits for identity readiness", async () => {
  const view = render(<Library ready={false} />);
  act(() => connections.setMode("backup"));
  await act(async () => {});
  expect(reads).toHaveLength(0);
  entrySession = "another-user-session";
  view.rerender(<Library />);
  await waitFor(() => expect(connections.getSnapshot().identity.backup).toBe("conflict"));
  expect(reads).toHaveLength(0);
  expect(screen.getByText("未确认云端权限")).toBeInTheDocument();
});
