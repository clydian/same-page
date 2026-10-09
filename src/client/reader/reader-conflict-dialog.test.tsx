import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { authenticatedLocalOwnerKey } from "../platform/local-workspace";
import type { AnnotationConflictRecord } from "../platform/local-database";
import type { PDFDocumentProxy } from "./pdf-document";
import { ReaderConflictDialog } from "./reader-conflict-dialog";

vi.mock("./pdf-page", () => ({ PdfPageCanvas: () => <div data-testid="pdf" /> }));
vi.mock("./use-pdf-page-geometry", () => ({ usePdfPageAspectRatio: () => .707 }));
vi.mock("../annotations/annotation-overlay", () => ({ AnnotationOverlay: ({ annotations }: { annotations: { payload: { text?: string } | null }[] }) => <div>{annotations.map((a, i) => <span key={i}>{a.payload?.text}</span>)}</div> }));
beforeEach(() => vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} }));
const conflict: AnnotationConflictRecord = { ownerKey: authenticatedLocalOwnerKey("one"), scopeKey: "scope", choirId: "drive", scoreId: "score", opId: "op", layerId: "layer", annotationId: "note", createdAt: 1,
  localDeleted: false, localPayload: { kind: "text", pageNumber: 1, x: .4, y: .4, fontScale: .024, text: "本机内容" },
  canonical: { id: "note", layerId: "layer", version: 2, deleted: false, payload: { kind: "text", pageNumber: 1, x: .5, y: .5, fontScale: .024, text: "云端内容" }, createdByDisplayName: "甲", updatedByDisplayName: "乙", updatedAt: 2 } };
const props = { conflicts: [conflict], document: { numPages: 2 } as PDFDocumentProxy, layers: [{ id: "layer", kind: "personal" as const, sharedSlot: null, name: "我的笔记", sortOrder: 0, subscribed: true, canEdit: true, displayColor: "#dc2626", subscriptionSource: "product" as const, colorSource: "product" as const, adminDefaultColor: "#dc2626", driveSubscribed: null, driveColorOverride: null, scoreSubscriptionOverride: null }],
  annotations: [{ ...conflict, id: "note", key: "note", deleted: false, version: 1, baseVersion: 1, state: "conflict" as const, payload: conflict.localPayload, lastOpId: null, syncErrorCode: null, createdByDisplayName: "甲", updatedByDisplayName: "甲", updatedAt: 1 }],
  syncStatus: { kind: "quiet" as const, message: "没有待上传的修改" }, canRetry: true, onRetry: vi.fn().mockResolvedValue(undefined), online: false, onRefresh: vi.fn().mockResolvedValue(true), onResolve: vi.fn().mockResolvedValue("conflict-discarded"), onClose: vi.fn() };
function mount(input = props) {
  return render(<MemoryRouter><ReaderConflictDialog {...input} /></MemoryRouter>);
}
it("previewing a cloud variant preserves the PDF node and does not select or discard a draft", async () => {
  const onResolve = vi.fn(); mount({ ...props, onResolve });
  const canvas = screen.getByTestId("pdf");
  fireEvent.click(screen.getByRole("button", { name: "云端版本 · 第 1 页" }));
  expect(screen.getByTestId("pdf")).toBe(canvas);
  expect(screen.getByRole("radio", { name: "采用云端版本" })).not.toBeChecked();
  expect(screen.getByRole("button", { name: "确认选择" })).toBeDisabled();
  expect(onResolve).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("radio", { name: "采用云端版本" }));
  fireEvent.click(screen.getByRole("button", { name: "确认选择" }));
  expect(onResolve).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "确认处理" }));
  await waitFor(() => expect(onResolve).toHaveBeenCalledWith("op", "discard", conflict));
});
it("a newly observed local edit removes the old confirmation and requires a fresh choice", async () => {
  const view = mount();
  fireEvent.click(screen.getByRole("radio", { name: "采用云端版本" }));
  fireEvent.click(screen.getByRole("button", { name: "确认选择" }));
  const latest = { ...conflict, localPayload: { ...conflict.localPayload!, kind: "text" as const, text: "继续修改", pageNumber: 1, x: .4, y: .4, fontScale: .024 } };
  view.rerender(<MemoryRouter><ReaderConflictDialog {...props} conflicts={[latest]} /></MemoryRouter>);
  expect(screen.queryByRole("button", { name: "确认处理" })).toBeNull();
  expect(screen.getByRole("button", { name: "确认选择" })).toBeDisabled();
});
it("deletion has an explicit state, excludes keep-both and retains the choice on a failed save", async () => {
  const onResolve = vi.fn().mockResolvedValue("failed");
  mount({ ...props, conflicts: [{ ...conflict, localDeleted: true, localPayload: null }], onResolve });
  expect(screen.getByText("本机已删除这条笔记")).toBeVisible();
  expect(screen.queryByRole("radio", { name: "两份都保留" })).toBeNull();
  fireEvent.click(screen.getByRole("radio", { name: "仍要删除" }));
  fireEvent.click(screen.getByRole("button", { name: "确认选择" }));
  fireEvent.click(screen.getByRole("button", { name: "确认处理" }));
  await screen.findByText("处理未完成，本机内容保留，请重试。");
  expect(screen.getByRole("radio", { name: "仍要删除" })).toBeChecked();
});

it("shows cloud content age and explicitly says the offline check time is unknown", () => {
  mount(); fireEvent.click(screen.getByRole("button", { name: "云端版本 · 第 1 页" }));
  expect(screen.getByText(/云端修改于.*快照核对时间未知/)).toBeVisible();
});
it("keeps pending permission feedback and a retry after the local choice removes the conflict", async () => {
  const onRetry = vi.fn().mockResolvedValue(undefined);
  const view = mount({ ...props, onRetry });
  fireEvent.click(screen.getByRole("radio", { name: "采用本机修改" }));
  fireEvent.click(screen.getByRole("button", { name: "确认选择" }));
  fireEvent.click(screen.getByRole("button", { name: "确认处理" }));
  await waitFor(() => expect(props.onResolve).toHaveBeenCalled());
  view.rerender(<MemoryRouter><ReaderConflictDialog {...props} conflicts={[]} onRetry={onRetry}
    syncStatus={{ kind: "failed", message: "原图层编辑权已撤销，本机草稿保留。" }} /></MemoryRouter>);
  expect(screen.getByText("原图层编辑权已撤销，本机草稿保留。")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "重试同步" }));
  await waitFor(() => expect(onRetry).toHaveBeenCalledTimes(1));
});
