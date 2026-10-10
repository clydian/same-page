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
