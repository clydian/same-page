import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { CliTokenCredential } from "../../shared/cli-tokens";
import { CliTokens } from "./cli-tokens";

const token: CliTokenCredential = {
  id: "11111111-1111-4111-8111-111111111111", name: "本机转谱", canUpload: false,
  driveIds: ["drive-a"], createdAt: Date.now(), expiresAt: Date.now() + 7 * 86400000,
  revokedAt: null, lastUsedAt: null,
};
const secret = "spcli_test-secret-once";
const drives = { drives: [{ id: "drive-a", name: "合唱团 A" }, { id: "drive-b", name: "合唱团 B" }] };
afterEach(() => vi.unstubAllGlobals());

it("creates a token for selected drives with read-only defaults and hides its one-time value", async () => {
  const writes: unknown[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    if (init?.method === "POST") {
      writes.push(JSON.parse(init.body));
      return Response.json({ token: secret, credential: token });
    }
    return Response.json(String(url).endsWith("/drives") ? drives : { tokens: [] });
  }));
  render(<CliTokens canUpload={false} onError={vi.fn()} />);
  const name = await screen.findByRole("textbox", { name: "名称" });
  expect(screen.queryByRole("option", { name: "允许上传候选" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "创建令牌" })).toBeDisabled();
  fireEvent.change(name, { target: { value: " 本机转谱 " } });
  fireEvent.click(screen.getByRole("checkbox", { name: "合唱团 A" }));
  fireEvent.click(screen.getByRole("button", { name: "创建令牌" }));
  expect(await screen.findByRole("textbox", { name: "新建 CLI 令牌" })).toHaveValue(secret);
  expect(writes).toEqual([{ name: token.name, canUpload: false, driveIds: ["drive-a"], expiresInDays: 7 }]);
  const list = screen.getByRole("table", { name: "现有 CLI 令牌" });
  expect(list).toHaveTextContent(token.name);
  expect(list).not.toHaveTextContent(secret);
  expect(within(list).getByText("合唱团 A")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "关闭令牌显示" }));
  expect(screen.queryByRole("textbox", { name: "新建 CLI 令牌" })).not.toBeInTheDocument();
  expect(screen.getByRole("table")).toHaveTextContent(token.name);
});

it("retains creation choices on failure and lets reviewers retry an upload token", async () => {
  const writes: unknown[] = [];
  const onError = vi.fn();
  let attempt = 0;
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    if (init?.method === "POST") {
      writes.push(JSON.parse(init.body));
      if (++attempt === 1) return Response.json({ error: "temporary" }, { status: 503 });
      return Response.json({ token: secret, credential: { ...token, canUpload: true } });
    }
    return Response.json(String(url).endsWith("/drives") ? drives : { tokens: [] });
  }));
  render(<CliTokens canUpload onError={onError} />);
  fireEvent.change(await screen.findByRole("textbox", { name: "名称" }), { target: { value: token.name } });
  fireEvent.change(screen.getByRole("combobox", { name: "访问权限" }), { target: { value: "upload" } });
  fireEvent.change(screen.getByRole("combobox", { name: "有效期" }), { target: { value: "30" } });
  fireEvent.click(screen.getByRole("checkbox", { name: "合唱团 B" }));
  fireEvent.click(screen.getByRole("button", { name: "创建令牌" }));
  expect(await screen.findByRole("alert")).toBeVisible();
  expect(screen.getByRole("textbox", { name: "名称" })).toHaveValue(token.name);
  expect(screen.getByRole("checkbox", { name: "合唱团 B" })).toBeChecked();
  await waitFor(() => expect(screen.getByRole("button", { name: "创建令牌" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "创建令牌" }));
  expect(await screen.findByRole("textbox", { name: "新建 CLI 令牌" })).toHaveValue(secret);
  expect(writes).toEqual(Array(2).fill({ name: token.name, canUpload: true, driveIds: ["drive-b"], expiresInDays: 30 }));
  expect(onError).toHaveBeenCalledOnce();
});

it("keeps failed revocation retryable and shows revoked and expired tokens without actions", async () => {
  const revoked = { ...token, id: "22222222-2222-4222-8222-222222222222", name: "已撤销设备", revokedAt: Date.now() };
  const expired = { ...token, id: "33333333-3333-4333-8333-333333333333", name: "过期设备", expiresAt: 1 };
  let attempts = 0;
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    if (init?.method === "DELETE") {
      if (++attempts === 1) return Response.json({ error: "temporary" }, { status: 503 });
      return new Response(null, { status: 204 });
    }
    return Response.json(String(url).endsWith("/drives") ? drives : { tokens: [token, revoked, expired] });
  }));
  render(<CliTokens canUpload={false} onError={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: `撤销 ${token.name}` }));
  expect(await screen.findByRole("alert")).toBeVisible();
  await waitFor(() => expect(screen.getByRole("button", { name: `撤销 ${token.name}` })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: `撤销 ${token.name}` }));
  expect(await screen.findByRole("status")).toHaveTextContent(`已撤销「${token.name}」。`);
  expect(screen.queryByRole("button", { name: /^撤销 / })).not.toBeInTheDocument();
  expect(screen.getAllByText("已撤销")).toHaveLength(2);
  expect(screen.getByText("已到期")).toBeVisible();
  expect(attempts).toBe(2);
});

it("can retry initial loading and does not recover a secret after leaving the panel", async () => {
  let fail = true;
  let saved = false;
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    if (init?.method === "POST") { saved = true; return Response.json({ token: secret, credential: token }); }
    if (String(url).endsWith("/drives")) return Response.json(drives);
    if (fail) return Response.json({ error: "temporary" }, { status: 503 });
    return Response.json({ tokens: saved ? [token] : [] });
  }));
  const onError = vi.fn();
  const panel = render(<CliTokens canUpload={false} onError={onError} />);
  expect(await screen.findByRole("alert")).toBeVisible();
  fail = false;
  await waitFor(() => expect(screen.getByRole("button", { name: "刷新令牌" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "刷新令牌" }));
  fireEvent.change(await screen.findByRole("textbox", { name: "名称" }), { target: { value: token.name } });
  fireEvent.click(screen.getByRole("checkbox", { name: "合唱团 A" }));
  fireEvent.click(screen.getByRole("button", { name: "创建令牌" }));
  expect(await screen.findByRole("textbox", { name: "新建 CLI 令牌" })).toHaveValue(secret);
  panel.unmount();
  render(<CliTokens canUpload={false} onError={onError} />);
  expect(await screen.findByRole("table", { name: "现有 CLI 令牌" })).toBeVisible();
  expect(screen.queryByRole("textbox", { name: "新建 CLI 令牌" })).not.toBeInTheDocument();
});
