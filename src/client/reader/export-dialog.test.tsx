import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { loadLocale } from "../../i18n/catalogs";
import { AppLocaleContext } from "../../i18n/context";
import type { AnnotationLayerSummary } from "../../shared/annotations";
import { guestNoteLayer } from "../annotations/guest-notes";
import { ExportDialog } from "./export-dialog";
import { authenticatedLocalOwnerKey, createLocalWorkspace, LocalWorkspaceOwnerChangedError } from "../platform/local-workspace";

const io = vi.hoisted(() => ({ read: vi.fn(), prepare: vi.fn(), generate: vi.fn() }));
vi.mock("../annotations/annotation-state", () => ({ readScoreAnnotationState: io.read }));
vi.mock("./prepare-export", () => ({ prepareExport: io.prepare }));
vi.mock("./export-score", () => ({ exportScore: io.generate }));
const workspace = createLocalWorkspace(authenticatedLocalOwnerKey("reader"), "drive", "score");
const state = { layers: [], annotations: [] };

beforeEach(() => {
  vi.resetAllMocks();
  io.prepare.mockReturnValue({ promise: Promise.resolve({ source: {}, layers: [] }), destroy: vi.fn() });
  io.generate.mockResolvedValue({ blob: new Blob(["pdf"], { type: "application/pdf" }), snapshot: JSON.stringify(state) });
});

it("shows a failed local read and retries it without reopening or generating twice", async () => {
  io.read.mockRejectedValueOnce(new Error("IndexedDB read failed")).mockResolvedValue(state);
  render(<ExportDialog workspace={workspace} versionId="v1" fileName="score.pdf" authenticatedUserId="reader" onClose={() => {}} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("无法读取本机笔记");
  expect(io.generate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "重试读取" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "下载 PDF" })).toBeEnabled());
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(io.generate).toHaveBeenCalledOnce();
  expect(io.prepare).toHaveBeenCalledOnce();
});

it("explains an invalidated owner instead of showing indefinite preparation", async () => {
  io.read.mockRejectedValue(new LocalWorkspaceOwnerChangedError());
  render(<ExportDialog workspace={workspace} versionId="v1" fileName="score.pdf" authenticatedUserId="reader" onClose={() => {}} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("登录状态已变化");
  expect(screen.getByRole("button", { name: "分享 PDF" })).toBeDisabled();
  expect(io.generate).not.toHaveBeenCalled();
});

it("retires the old target immediately when the PDF version changes", async () => {
  io.read.mockResolvedValue(state);
  const { rerender } = render(<ExportDialog workspace={workspace} versionId="v1" fileName="score.pdf" authenticatedUserId="reader" onClose={() => {}} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "下载 PDF" })).toBeEnabled());
  io.prepare.mockReturnValueOnce({ promise: new Promise(() => {}), destroy: vi.fn() });
  rerender(<ExportDialog workspace={workspace} versionId="v2" fileName="score.pdf" authenticatedUserId="reader" onClose={() => {}} />);
  expect(screen.queryByRole("button", { name: "下载 PDF" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "正在准备…" })).toBeDisabled();
});

it("localizes the preview layer label and preserves user-entered layer names", async () => {
  await loadLocale("en");
  const previewLayer = guestNoteLayer();
  io.read.mockResolvedValue({ ...state, layers: [previewLayer, { ...previewLayer, id: "custom-layer" }] });
  render(<AppLocaleContext.Provider value={{ locale: "en", setLocale: () => undefined, requestedLocale: null, loadFailed: false }}>
    <ExportDialog workspace={workspace} versionId="v1" fileName="score.pdf" authenticatedUserId="reader" onClose={() => {}} />
  </AppLocaleContext.Provider>);
  fireEvent.click(await screen.findByRole("radio", { name: "Include notes" }));
  expect(await screen.findByRole("checkbox", { name: "Local preview notes" })).not.toBeChecked();
  expect(screen.getByRole("checkbox", { name: previewLayer.name })).toBeInTheDocument();
});

it("keeps read-only shared layers and member shares in their respective export groups", async () => {
  const personal = { ...guestNoteLayer(), id: "personal", name: "我的笔记" };
  const memberShare = { ...personal, id: "member-share", name: "声部长的笔记", canEdit: false, sharing: true };
  const shared: AnnotationLayerSummary = { ...personal, id: "shared", kind: "shared", sharedSlot: "E", name: "Ensemble", canEdit: false };
  io.read.mockResolvedValue({ ...state, layers: [memberShare, personal, shared] });
  render(<ExportDialog workspace={workspace} versionId="v1" fileName="score.pdf" authenticatedUserId="reader" onClose={() => {}} />);

  fireEvent.click(await screen.findByRole("radio", { name: "包含笔记" }));
  expect(within(await screen.findByRole("group", { name: "共享层" })).getByRole("checkbox", { name: "Ensemble" })).toBeEnabled();
  expect(within(screen.getByRole("group", { name: "我的个人层" })).getByRole("checkbox", { name: "我的笔记" })).not.toBeChecked();
  expect(within(screen.getByRole("group", { name: "成员分享" })).getByRole("checkbox", { name: "声部长的笔记" })).not.toBeChecked();
});
