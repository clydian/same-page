import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { diagnosticFetch } from "../../diagnostics/diagnostics";
import { uploadBody } from "../upload-transport";
import { useAttachmentMutation } from "./use-attachment-mutation";

vi.mock("../../diagnostics/diagnostics", () => ({ diagnosticFetch: vi.fn() }));
vi.mock("../upload-transport", () => ({ uploadBody: vi.fn() }));

it("recovers a committed deletion after its response is lost without sending the deletion twice", async () => {
  const fetch = vi.mocked(diagnosticFetch);
  fetch.mockReset();
  fetch.mockRejectedValueOnce(new TypeError("response lost"))
    .mockResolvedValueOnce(Response.json({ state: "trashed" }));
  const onChanged = vi.fn().mockResolvedValue(undefined), onComplete = vi.fn();
  const { result } = renderHook(() => useAttachmentMutation({ choirId: "drive", scoreId: "score", id: "attachment", enabled: true, onChanged, onComplete }));
  await act(async () => { expect(await result.current.save({ kind: "trash", revision: 1 })).toBe(false); });
  expect(result.current.needsRefresh).toBe(true);
  expect(onComplete).not.toHaveBeenCalled();
  await act(async () => { await result.current.refresh(); });
  expect(result.current.saved).toBe(true);
  expect(onChanged).toHaveBeenCalledTimes(1);
  expect(onComplete).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(1);
});

it("refreshes a confirmed save without resending it when the directory refresh fails", async () => {
  const fetch = vi.mocked(diagnosticFetch);
  fetch.mockReset();
  fetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
  const onChanged = vi.fn().mockRejectedValueOnce(new Error("directory unavailable")).mockResolvedValue(undefined);
  const onComplete = vi.fn();
  const { result } = renderHook(() => useAttachmentMutation({ choirId: "drive", scoreId: "score", id: "attachment", enabled: true, onChanged, onComplete }));
  await act(async () => { expect(await result.current.save({ kind: "trash", revision: 1 })).toBe(false); });
  expect(result.current.saved).toBe(true);
  expect(result.current.message).toContain("已保存。但刷新失败");
  expect(onComplete).not.toHaveBeenCalled();
  await act(async () => { await result.current.refresh(); });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(onComplete).toHaveBeenCalledTimes(1);
});

const markdown = { id: "attachment", scoreId: "score", name: "notes.md", kind: "markdown", url: null, sizeBytes: 10, revision: 2, updatedAt: 1, trashExpiresAt: null };

it.each([true, false])("adopts a recovered Markdown save only when the saved content matches (matches=%s)", async matches => {
  const fetch = vi.mocked(diagnosticFetch);
  fetch.mockReset();
  vi.mocked(uploadBody).mockReset().mockRejectedValueOnce(new TypeError("response lost"));
  fetch.mockResolvedValueOnce(Response.json({ state: "available", attachment: markdown }))
    .mockResolvedValueOnce(Response.json({ attachment: markdown }))
    .mockResolvedValueOnce(new Response(matches ? "my draft" : "another editor's text"));
  const onSaved = vi.fn(), onChanged = vi.fn().mockResolvedValue(undefined);
  const { result } = renderHook(() => useAttachmentMutation({ choirId: "drive", scoreId: "score", id: "attachment", enabled: true, onChanged, onSaved }));
  await act(async () => { await result.current.save({ kind: "markdown", name: "notes.md", text: "my draft", revision: 1 }); });
  await act(async () => { await result.current.refresh().catch(() => {}); });
  expect(result.current.saved).toBe(matches);
  expect(result.current.needsRefresh).toBe(!matches);
  if (matches) expect(onSaved).toHaveBeenCalledWith({ attachment: markdown, text: "my draft" });
  else {
    expect(onSaved).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
    expect(result.current.message).toContain("当前修改仍保留");
  }
});

it("reuses the request identity after a cancelled upload is confirmed absent", async () => {
  const fetch = vi.mocked(diagnosticFetch);
  fetch.mockReset().mockResolvedValueOnce(Response.json({ state: "absent" }));
  const upload = vi.mocked(uploadBody);
  upload.mockReset().mockImplementationOnce((_url, _body, signal) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
  })).mockResolvedValueOnce(Response.json({ attachment: markdown }));
  const onChanged = vi.fn().mockResolvedValue(undefined);
  const { result } = renderHook(() => useAttachmentMutation({ choirId: "drive", scoreId: "score", id: "attachment", enabled: true, onChanged }));
  const intent = { kind: "upload" as const, name: "notes.md", file: new File(["draft"], "notes.md") };
  let saving!: Promise<boolean | null>;
  act(() => { saving = result.current.save(intent); });
  await act(async () => { result.current.cancel(); await saving; });
  expect(result.current.needsRefresh).toBe(true);
  await act(async () => { await result.current.refresh(); });
  expect(result.current.blocked).toBe(false);
  await act(async () => { expect(await result.current.save(intent)).toBe(true); });
  expect(upload.mock.calls[1][0]).toBe(upload.mock.calls[0][0]);
});

it("does not replace an admitted intent on double submit or adopt results after unmount", async () => {
  let resolve!: (value: Response) => void;
  const fetch = vi.mocked(diagnosticFetch);
  fetch.mockReset().mockReturnValueOnce(new Promise<Response>(done => { resolve = done; }));
  const onChanged = vi.fn(), onSaved = vi.fn();
  const { result, unmount } = renderHook(() => useAttachmentMutation({ choirId: "drive", scoreId: "score", id: "attachment", enabled: true, onChanged, onSaved }));
  let saving!: Promise<boolean | null>;
  await act(async () => {
    saving = result.current.save({ kind: "trash", revision: 1 });
    expect(await result.current.save({ kind: "modify", name: "unexpected.md", revision: 1 })).toBeNull();
  });
  unmount();
  await act(async () => { resolve(new Response(null, { status: 204 })); expect(await saving).toBeNull(); });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(onSaved).not.toHaveBeenCalled();
  expect(onChanged).not.toHaveBeenCalled();
});
