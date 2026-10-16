import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import type { AdminScore, XmlCandidate } from "../../shared/admin";
import { readAdminDetail } from "./api";
import { ScoreReview } from "./score-review";

vi.mock("./api", () => ({ readAdminDetail: vi.fn() }));
vi.mock("./import-xml", () => ({ ImportXml: () => null }));
vi.mock("./review-content", () => ({
  ReviewContent: ({ candidate }: { candidate?: XmlCandidate }) => <p>{candidate?.name ?? "原 PDF 预览"}</p>,
}));
const score: AdminScore = {
  id: "score", choirId: "drive", driveName: "云盘", fileName: "合唱.pdf",
  versionId: "pdf", sha256: "hash", pageCount: 2, disabled: 0,
  attachmentId: null, attachmentRevision: null, publishedSource: null,
  candidateState: "ready", candidateReview: "pending", candidateSource: "pdf",
};
const latest: XmlCandidate = {
  id: "latest", name: "最新草稿", sourceVersionId: "pdf", sourceSha256: "hash",
  sizeBytes: 10, sha256: "hash", state: "ready", tool: "", parameters: "",
  createdAt: 2, expiresAt: Date.now() + 10000, review: "pending", reviewRevision: 0,
  reviewedBy: null, reviewedAt: null, reviewNote: "", technicalPassed: 0,
};
const old: XmlCandidate = { ...latest, id: "old", name: "较早草稿", createdAt: 1 };
beforeEach(() => {
  vi.mocked(readAdminDetail).mockReset();
  vi.mocked(readAdminDetail).mockImplementation(async (_id, _signal, before, selected) => ({
    score,
    candidates: before ? [old] : [latest],
    selectedCandidate: selected === old.id ? old : null,
    nextBefore: before ? null : "2:latest",
  }));
});
function openReview() {
  render(<MemoryRouter><ScoreReview id="score" cap={{ viewScores: 1, reviewXml: 1, publishXml: 1 }} onError={vi.fn()} onDenied={vi.fn()} /></MemoryRouter>);
}
it("keeps an explicit original PDF selection when metadata is refreshed", async () => {
  openReview();
  const picker = await screen.findByLabelText("比较结果");
  await act(async () => { fireEvent.change(picker, { target: { value: "" } }); });
  await waitFor(() => expect(screen.getByText("原 PDF 预览")).toBeVisible());
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "刷新", exact: true })); });
  await waitFor(() => expect(screen.getByText("原 PDF 预览")).toBeVisible());
  expect(screen.getByLabelText("比较结果")).toHaveValue("");
});
it("reloads a selected older candidate even when it is outside the first page", async () => {
  openReview();
  const olderButton = await screen.findByRole("button", { name: "更早的候选" });
  await act(async () => { fireEvent.click(olderButton); });
  await screen.findByRole("option", { name: /较早草稿/ });
  await act(async () => { fireEvent.change(screen.getByLabelText("比较结果"), { target: { value: old.id } }); });
  await waitFor(() => expect(readAdminDetail).toHaveBeenLastCalledWith("score", expect.any(AbortSignal), undefined, old.id));
  await waitFor(() => expect(screen.getByText(old.name, { selector: "p" })).toBeVisible());
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "刷新", exact: true })); });
  await waitFor(() => expect(screen.getByText(old.name, { selector: "p" })).toBeVisible());
  expect(screen.getByLabelText("比较结果")).toHaveValue(old.id);
});
