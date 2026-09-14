import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
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
