import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import AdminPage from "./admin-page";

const account = vi.hoisted(() => ({ userId: "first-operator", sessionId: "first-session" }));
vi.mock("../auth/application-identity", () => ({
  useApplicationIdentity: () => ({ onlineState: "authenticated", session: { data: { user: { id: account.userId, email: `${account.userId}@example.com` }, session: { id: account.sessionId } } } }),
}));
vi.mock("../navigation/navigation-context", () => ({
  useAppNavigation: () => ({ afterEditing: (action: () => void) => action() }),
}));
vi.mock("./directory", () => ({ Directory: () => <p>乐谱列表</p> }));
vi.mock("./score-review", () => ({ ScoreReview: () => null }));
vi.mock("./audit", () => ({ Audit: () => null }));
vi.mock("./diagnostic-inbox", () => ({ DiagnosticInbox: () => <p>问题反馈列表</p> }));
vi.mock("./releases", () => ({ Releases: () => null }));
afterEach(() => { vi.unstubAllGlobals(); account.userId = "first-operator"; account.sessionId = "first-session"; });

it("clears the CLI panel and its one-time secret when the authenticated account changes", async () => {
  const secret = "spcli_first-account-secret";
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    if (String(url).endsWith("/session")) return Response.json({ viewScores: 1, reviewXml: 1, publishXml: 1 });
    if (String(url).endsWith("/drives")) return Response.json({ drives: [{ id: "drive", name: "试点云盘" }] });
    if (init?.method === "POST") return Response.json({ token: secret, credential: { id: "11111111-1111-4111-8111-111111111111", name: "转谱设备", canUpload: false, driveIds: ["drive"], createdAt: Date.now(), expiresAt: Date.now() + 86400000, revokedAt: null, lastUsedAt: null } });
    return Response.json({ tokens: [] });
  }));
  const app = render(<MemoryRouter><AdminPage /></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button", { name: "CLI 令牌" }));
  fireEvent.change(await screen.findByRole("textbox", { name: "名称" }), { target: { value: "转谱设备" } });
  fireEvent.click(screen.getByRole("checkbox", { name: "试点云盘" }));
  fireEvent.click(screen.getByRole("button", { name: "创建令牌" }));
  expect(await screen.findByRole("textbox", { name: "新建 CLI 令牌" })).toHaveValue(secret);
  account.userId = "second-operator";
  account.sessionId = "second-session";
  app.rerender(<MemoryRouter><AdminPage /></MemoryRouter>);
  expect(await screen.findByText("乐谱列表")).toBeVisible();
  expect(screen.queryByRole("textbox", { name: "新建 CLI 令牌" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "CLI 令牌" }));
  expect(await screen.findByText("还没有 CLI 令牌。")).toBeVisible();
  expect(screen.queryByDisplayValue(secret)).not.toBeInTheDocument();
});

it("does not offer CLI tokens to an operator without score access", async () => {
  const fetch = vi.fn(async () => Response.json({ viewScores: 0, reviewXml: 0, publishXml: 0, manageReports: 1 }));
  vi.stubGlobal("fetch", fetch);
  render(<MemoryRouter><AdminPage /></MemoryRouter>);
  expect(await screen.findByText("问题反馈列表")).toBeVisible();
  expect(screen.queryByRole("button", { name: "CLI 令牌" })).not.toBeInTheDocument();
  expect(fetch).toHaveBeenCalledTimes(1);
});
