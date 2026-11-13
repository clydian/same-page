import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useApplicationIdentity } from "./application-identity";
import { localDatabase } from "../platform/local-database";
import type { LocalWorkspaceOwnerKey } from "../platform/local-workspace";

const state = vi.hoisted(() => ({
  data: { user: { id: "owner" }, session: { id: "session" } } as { user: { id: string }; session: { id: string } } | null,
  error: null as { status: number } | null,
  owner: null as Promise<LocalWorkspaceOwnerKey | null> | null,
}));
vi.mock("./auth-client", () => ({ authClient: { useSession: () => ({ data: state.data, error: state.error, isPending: false, isRefetching: false }) } }));
vi.mock("../platform/local-workspace", async importOriginal => ({
  ...await importOriginal<typeof import("../platform/local-workspace")>(),
  currentLocalOwnerKey: () => state.owner,
}));

it("retains the displayed owner through a session failure while local identity restoration is pending", async () => {
  await localDatabase.open();
  let restore!: (owner: LocalWorkspaceOwnerKey | null) => void;
  state.owner = new Promise(resolve => { restore = resolve; });
  const { result, rerender } = renderHook(() => useApplicationIdentity());
  expect(result.current.localUserId).toBe("owner");
  expect(result.current.authenticatedUserId).toBe("owner");
  state.data = null;
  state.error = { status: 503 };
  rerender();
  expect(result.current.localUserId).toBe("owner");
  expect(result.current.authenticatedUserId).toBeNull();
  expect(result.current.onlineState).toBe("unreachable");
  expect(result.current.restoring).toBe(false);
  await act(async () => restore("user:owner" as LocalWorkspaceOwnerKey));
  await waitFor(() => expect(result.current.localUserId).toBe("owner"));
  state.error = null;
  state.data = { user: { id: "another-owner" }, session: { id: "another-session" } };
  rerender();
  expect(result.current.localUserId).toBe("another-owner");
  expect(result.current.authenticatedUserId).toBe("another-owner");
});

it("distinguishes cold local-owner waiting from the same page after an online identity has warmed it", async () => {
  const { useReaderWorkspace } = await import("../reader/use-reader-workspace");
  const { activateAuthenticatedLocalOwner } = await import("../platform/local-workspace");
  await localDatabase.open();
  await activateAuthenticatedLocalOwner("owner");
  let restore!: (owner: LocalWorkspaceOwnerKey | null) => void;
  state.owner = new Promise(resolve => { restore = resolve; });
  state.data = null;
  state.error = { status: 503 };
  const { result, rerender, unmount } = renderHook(() => {
    const identity = useApplicationIdentity();
    return { identity, workspace: useReaderWorkspace({ choirId: "choir", scoreId: "score", experience: false, identity }) };
  });
  try {
    // Only the identity restoration lookup is held. The stored owner and the
    // workspace database are healthy; this models a stalled cold read, not its cause.
    expect(result.current.identity.restoring).toBe(true);
    expect(result.current.identity.localUserId).toBeNull();
    expect(result.current.workspace.state.status).toBe("opening");
    state.data = { user: { id: "owner" }, session: { id: "session" } };
    state.error = null;
    rerender();
    await waitFor(() => expect(result.current.workspace.state.status).toBe("ready"));
    const ready = result.current.workspace.state;
    state.data = null;
    state.error = { status: 503 };
    rerender();
    expect(result.current.identity.authenticatedUserId).toBeNull();
    expect(result.current.identity.localUserId).toBe("owner");
    expect(result.current.identity.restoring).toBe(false);
    expect(result.current.workspace.state).toBe(ready);
    await act(async () => restore("user:owner" as LocalWorkspaceOwnerKey));
    expect(result.current.workspace.state).toBe(ready);
  } finally {
    restore("user:owner" as LocalWorkspaceOwnerKey);
    unmount();
    state.data = { user: { id: "owner" }, session: { id: "session" } };
    state.error = null;
    state.owner = null;
  }
});
