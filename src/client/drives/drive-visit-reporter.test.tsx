import { act, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DriveVisitReporter } from "./drive-visit-reporter";
import { connectionFetch, connectionUrl } from "../connection/connection";
import { ConnectionController } from "../connection/controller";

const identity = vi.hoisted(() => ({ authenticatedUserId: "member-a" as string | null, authenticatedSessionId: "session-a" as string | null }));
vi.mock("../auth/application-identity", () => ({ useApplicationIdentity: () => identity }));
vi.mock("../connection/connection", () => ({ connectionFetch: vi.fn(async () => new Response(null, { status: 204 })), connectionUrl: vi.fn((path: string) => path) }));
beforeEach(() => { vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 }))); vi.mocked(connectionUrl).mockImplementation(path => path); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks(); vi.clearAllMocks(); identity.authenticatedUserId = "member-a"; identity.authenticatedSessionId = "session-a"; });

it("does not send in the background or offline, has no heartbeat, and fences identity changes", async () => {
  vi.useFakeTimers();
  let visible = "hidden", online = true;
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visible as DocumentVisibilityState);
  vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
  const view = render(<MemoryRouter initialEntries={["/choirs/drive-a"]}><DriveVisitReporter /></MemoryRouter>);
  expect(fetch).not.toHaveBeenCalled();
  await act(async () => { visible = "visible"; document.dispatchEvent(new Event("visibilitychange")); });
  expect(fetch).toHaveBeenCalledTimes(1);
  const first = vi.mocked(fetch).mock.calls[0][1]!;
  expect(first.headers).toMatchObject({ "x-same-page-owner-user-id": "member-a", "x-same-page-visit": "foreground" });
  await act(async () => { vi.advanceTimersByTime(10 * 60_000); });
  expect(fetch).toHaveBeenCalledTimes(1);
  await act(async () => { online = false; window.dispatchEvent(new Event("offline")); document.dispatchEvent(new Event("visibilitychange")); });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(first.signal!.aborted).toBe(true);
  await act(async () => { online = true; window.dispatchEvent(new Event("online")); });
  expect(fetch).toHaveBeenCalledTimes(2);
  identity.authenticatedUserId = "member-b"; identity.authenticatedSessionId = "session-b";
  view.rerender(<MemoryRouter initialEntries={["/choirs/drive-a"]}><DriveVisitReporter /></MemoryRouter>);
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(vi.mocked(fetch).mock.calls[2][1]!.headers).toMatchObject({ "x-same-page-owner-user-id": "member-b" });
});

it("does not report admin, settings, local experience, or unconfirmed identities", () => {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  for (const path of ["/admin", "/admin?view=usage", "/choirs/drive-a/settings", "/choirs/drive-a/scores/score-a?experience=1"]) {
    const view = render(<MemoryRouter initialEntries={[path]}><DriveVisitReporter /></MemoryRouter>);
    view.unmount();
  }
  identity.authenticatedUserId = null; identity.authenticatedSessionId = null;
  render(<MemoryRouter initialEntries={["/choirs/drive-a/scores/score-a"]}><DriveVisitReporter /></MemoryRouter>);
  expect(fetch).not.toHaveBeenCalled();
});

it("does not let a visit response change connection health or routing", async () => {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  const send = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", send);
  const controller = new ConnectionController({ origins: { direct: "http://localhost", backup: "http://backup.test" }, pageOrigin: "http://localhost", send });
  controller.acceptIdentity("session-a");
  vi.mocked(connectionFetch).mockImplementation(controller.fetch);
  vi.mocked(connectionUrl).mockImplementation(path => controller.nativeEndpoint(path));
  const before = controller.getSnapshot();
  render(<MemoryRouter initialEntries={["/choirs/drive-a"]}><DriveVisitReporter /></MemoryRouter>);
  await waitFor(() => expect(send).toHaveBeenCalled());
  await act(async () => {});
  expect(controller.getSnapshot().health).toEqual(before.health);
  expect(controller.getSnapshot().active).toBe(before.active);
});
