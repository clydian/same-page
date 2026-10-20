import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { DiagnosticInbox } from "./diagnostic-inbox";
import { adminFetch } from "./api";
vi.mock("./api", () => ({ adminFetch: vi.fn() }));
const id = "11111111-1111-4111-8111-111111111111";
const summary = { id, clientBuild: "abcdef1", clientVersion: "v26.10.20.1830", status: "new", createdAt: 1, expiresAt: 2, description: "显示不正常", categories: [] };
const detail = { ...summary, report: { id, version: 1, clientBuild: "abcdef1", description: "<script>private text</script>", environment: { browser: "safari", browserVersion: null, system: "ios", systemVersion: null, viewportWidth: 390, viewportHeight: 844, standalone: true, serviceWorkerControlled: true, onlineHint: true }, records: [], reader: null } };
const onError = vi.fn();
afterEach(() => { vi.mocked(adminFetch).mockReset(); onError.mockReset(); });
function open(path = "/admin/reports", canDelete = 0) {
  return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/admin/reports/:reportId?" element={<DiagnosticInbox cap={{ viewScores: 0, reviewXml: 0, publishXml: 0, manageReports: 1, deleteReports: canDelete }} onError={onError} />} /></Routes></MemoryRouter>);
}
it("can retry the same query after a transient failure without getting stuck loading", async () => {
  vi.mocked(adminFetch).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(Response.json({ reports: [summary], next: null }));
  open();
  expect(await screen.findByRole("alert")).toHaveTextContent("无法读取反馈");
  fireEvent.click(screen.getByRole("button", { name: "筛选反馈" }));
  expect(await screen.findByRole("link", { name: summary.description })).toBeInTheDocument();
  expect(adminFetch).toHaveBeenCalledTimes(2);
});
it("keeps deletion unavailable without its own grant and renders user text safely", async () => {
  vi.mocked(adminFetch).mockResolvedValueOnce(Response.json(detail));
  open(`/admin/reports/${id}`);
  expect(await screen.findByText(detail.report.description)).toBeInTheDocument();
  expect(document.querySelector(".diagnostic-inbox-description script")).toBeNull();
  expect(screen.queryByRole("button", { name: "删除反馈" })).not.toBeInTheDocument();
});
it("requires deletion confirmation, deletes once, and returns to the filtered list", async () => {
  vi.mocked(adminFetch).mockResolvedValueOnce(Response.json(detail)).mockResolvedValueOnce(Response.json({ id })).mockResolvedValueOnce(Response.json({ reports: [], next: null }));
  open(`/admin/reports/${id}?status=new`, 1);
  fireEvent.click(await screen.findByRole("button", { name: "删除反馈" }));
  expect(screen.getByRole("dialog", { name: "删除这份反馈？" })).toBeInTheDocument();
  expect(adminFetch).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
  await screen.findByText("没有符合条件的反馈。");
  await waitFor(() => expect(adminFetch).toHaveBeenCalledWith(`/reports/${id}`, expect.objectContaining({ method: "DELETE" })));
  expect(adminFetch).toHaveBeenLastCalledWith("/reports?status=new", expect.anything());
});
