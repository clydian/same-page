import { act, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { DriveVisitReporter } from "./drive-visit-reporter";
import { connectionFetch } from "../connection/connection";

const identity = vi.hoisted(() => ({ authenticatedUserId: "member-a" as string | null, authenticatedSessionId: "session-a" as string | null }));
vi.mock("../auth/application-identity", () => ({ useApplicationIdentity: () => identity }));
vi.mock("../connection/connection", () => ({ connectionFetch: vi.fn(async () => new Response(null, { status: 204 })) }));
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.clearAllMocks(); identity.authenticatedUserId = "member-a"; identity.authenticatedSessionId = "session-a"; });

it("does not send in the background or offline, has no heartbeat, and fences identity changes", async () => {
  vi.useFakeTimers();
  let visible = "hidden", online = true;
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visible as DocumentVisibilityState);
  vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
  const view = render(<MemoryRouter initialEntries={["/choirs/drive-a"]}><DriveVisitReporter /></MemoryRouter>);
  expect(connectionFetch).not.toHaveBeenCalled();
  await act(async () => { visible = "visible"; document.dispatchEvent(new Event("visibilitychange")); });
  expect(connectionFetch).toHaveBeenCalledTimes(1);
  const first = vi.mocked(connectionFetch).mock.calls[0][1]!;
  expect(first.headers).toMatchObject({ "x-same-page-owner-user-id": "member-a", "x-same-page-visit": "foreground" });
  await act(async () => { vi.advanceTimersByTime(10 * 60_000); });
  expect(connectionFetch).toHaveBeenCalledTimes(1);
  await act(async () => { online = false; window.dispatchEvent(new Event("offline")); document.dispatchEvent(new Event("visibilitychange")); });
  expect(connectionFetch).toHaveBeenCalledTimes(1);
  expect(first.signal!.aborted).toBe(true);
  await act(async () => { online = true; window.dispatchEvent(new Event("online")); });
  expect(connectionFetch).toHaveBeenCalledTimes(2);
  identity.authenticatedUserId = "member-b"; identity.authenticatedSessionId = "session-b";
  view.rerender(<MemoryRouter initialEntries={["/choirs/drive-a"]}><DriveVisitReporter /></MemoryRouter>);
  expect(connectionFetch).toHaveBeenCalledTimes(3);
  expect(vi.mocked(connectionFetch).mock.calls[2][1]!.headers).toMatchObject({ "x-same-page-owner-user-id": "member-b" });
});

it("does not report admin, settings, or unconfirmed identities", () => {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  for (const path of ["/admin", "/admin?view=usage", "/choirs/drive-a/settings"]) {
    const view = render(<MemoryRouter initialEntries={[path]}><DriveVisitReporter /></MemoryRouter>);
    view.unmount();
  }
  identity.authenticatedUserId = null; identity.authenticatedSessionId = null;
  render(<MemoryRouter initialEntries={["/choirs/drive-a/scores/score-a"]}><DriveVisitReporter /></MemoryRouter>);
  expect(connectionFetch).not.toHaveBeenCalled();
});
