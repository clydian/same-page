import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { ScoreSummary } from "../../../shared/scores";
import type { ScoreAttachment } from "../../../shared/attachments";
import { diagnosticFetch } from "../../diagnostics/diagnostics";
import { useLibraryAttachments } from "./use-library-attachments";

vi.mock("../../diagnostics/diagnostics", () => ({ diagnosticFetch: vi.fn() }));
const fetchMock = vi.mocked(diagnosticFetch);
beforeEach(() => { fetchMock.mockReset(); });
function score(id: string): ScoreSummary {
  return { id, choirId: "drive", fileName: `${id}.pdf`, updatedAt: 1, attachmentCount: 1, currentVersion: {
    id: `${id}-version`, versionNumber: 1, sizeBytes: 100, sha256: "a".repeat(64), etag: id, pageCount: 1, createdAt: 1,
  } };
}
function attachment(scoreId: string): ScoreAttachment {
  return { id: `${scoreId}-attachment`, scoreId, name: `${scoreId}.md`, kind: "markdown", url: null, sizeBytes: 10, revision: 1, updatedAt: 1, trashExpiresAt: null };
}
function pending() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>(yes => { resolve = yes; });
  return { promise, resolve };
}
const first = score("first"), second = score("second");
const firstAttachment = attachment(first.id), secondAttachment = attachment(second.id);
const initialProps = { drive: "drive", scores: [first], active: true, generation: "session:0" };
const useAttachments = (props: typeof initialProps) => useLibraryAttachments(props.drive, props.scores, props.active, props.generation);

it("keeps unchanged rows visible while another score opens or closes", async () => {
  const expanding = pending(), collapsing = pending();
  fetchMock.mockResolvedValueOnce(Response.json({ attachments: [firstAttachment] }))
    .mockReturnValueOnce(expanding.promise).mockReturnValueOnce(collapsing.promise);
  const { result, rerender } = renderHook(useAttachments, { initialProps });
  await waitFor(() => expect(result.current.items).toEqual([firstAttachment]));
  rerender({ ...initialProps, scores: [first, second] });
  expect(result.current.loading).toBe(true);
  expect(result.current.items).toEqual([firstAttachment]);
  await act(async () => expanding.resolve(Response.json({ attachments: [firstAttachment, secondAttachment] })));
  expect(result.current.items).toEqual([firstAttachment, secondAttachment]);
  rerender(initialProps);
  expect(result.current.loading).toBe(true);
  expect(result.current.items).toEqual([firstAttachment]);
  await act(async () => collapsing.resolve(Response.json({ attachments: [firstAttachment] })));
  expect(result.current.loading).toBe(false);
  expect(result.current.items).toEqual([firstAttachment]);
});

it.each([
  { name: "session", next: { ...initialProps, generation: "other-session:0" } },
  { name: "mutation", next: { ...initialProps, generation: "session:1" } },
  { name: "drive", next: { ...initialProps, drive: "other-drive" } },
  { name: "score revision", next: { ...initialProps, scores: [{ ...first, updatedAt: 2 }] } },
  { name: "attachment count", next: { ...initialProps, scores: [{ ...first, attachmentCount: 2 }] } },
  { name: "access", next: { ...initialProps, active: false } },
])("does not retain stale rows after $name changes or accept an old pending response", async ({ next }) => {
  const oldRequest = pending(), newRequest = pending();
  fetchMock.mockResolvedValueOnce(Response.json({ attachments: [firstAttachment] }))
    .mockReturnValueOnce(oldRequest.promise).mockReturnValueOnce(newRequest.promise);
  const { result, rerender } = renderHook(useAttachments, { initialProps });
  await waitFor(() => expect(result.current.items).toEqual([firstAttachment]));
  rerender({ ...initialProps, scores: [first, second] });
  rerender(next);
  expect(result.current.items).toEqual([]);
  await act(async () => oldRequest.resolve(Response.json({ attachments: [firstAttachment, secondAttachment] })));
  expect(result.current.items).toEqual([]);
});

it("isolates loading and errors to unread scores while preserving other open attachments", async () => {
  const request = pending(), retry = pending();
  fetchMock.mockResolvedValueOnce(Response.json({ attachments: [firstAttachment] }))
    .mockReturnValueOnce(request.promise).mockReturnValueOnce(retry.promise);
  const { result, rerender } = renderHook(useAttachments, { initialProps });
  await waitFor(() => expect(result.current.statusFor(first.id)).toBe("ready"));
  rerender({ ...initialProps, scores: [first, second] });
  expect(result.current.statusFor(first.id)).toBe("ready");
  expect(result.current.statusFor(second.id)).toBe("loading");
  await act(async () => request.resolve(new Response(null, { status: 503 })));
  expect(result.current.items).toEqual([firstAttachment]);
  expect(result.current.statusFor(first.id)).toBe("ready");
  expect(result.current.statusFor(second.id)).toBe("error");
  act(() => result.current.retry());
  expect(result.current.statusFor(second.id)).toBe("loading");
  expect(result.current.items).toEqual([firstAttachment]);
  await act(async () => retry.resolve(Response.json({ attachments: [firstAttachment, secondAttachment] })));
  expect(result.current.statusFor(second.id)).toBe("ready");
});

it.each([401, 403, 404])("drops cached attachment metadata after explicit access failure %s", async status => {
  fetchMock.mockResolvedValueOnce(Response.json({ attachments: [firstAttachment] }))
    .mockResolvedValueOnce(new Response(null, { status }));
  const { result, rerender } = renderHook(useAttachments, { initialProps });
  await waitFor(() => expect(result.current.statusFor(first.id)).toBe("ready"));
  rerender({ ...initialProps, scores: [first, second] });
  await waitFor(() => expect(result.current.statusFor(first.id)).toBe("error"));
  expect(result.current.items).toEqual([]);
  expect(result.current.statusFor(second.id)).toBe("error");
});
