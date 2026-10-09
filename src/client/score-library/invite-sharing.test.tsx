import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InviteSharing } from "./invite-sharing";

vi.mock("./save-invite-card", () => ({ createInviteCardFile: async () => new File(["fixture"], "invite.png", { type: "image/png" }), deliverInviteCard: vi.fn() }));

afterEach(() => vi.unstubAllGlobals());

describe("current invite code", () => {
  it("restores a retained original without rotating it", async () => {
    const fetchMock = vi.fn().mockImplementation((_input: string, init?: RequestInit) =>
      Promise.resolve(init?.method === "PUT"
        ? new Response(null, { status: 204 })
        : Response.json({ joinCode: null })),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<InviteSharing choirId="drive" choirName="示例云盘" />);
    fireEvent.change(await screen.findByRole("textbox", { name: "邀请码" }), { target: { value: "ABCDEFGH" } });
    fireEvent.click(screen.getByRole("button", { name: "保存原邀请码" }));
    expect(await screen.findByRole("img", { name: "示例云盘邀请二维码" })).toHaveTextContent("ABCD–EFGH");
    expect(fetchMock).toHaveBeenCalledWith("/api/choirs/drive/join-code", {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ joinCode: "ABCDEFGH" }),
    });
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("rotate"), expect.anything());
  });

  it("keeps a mismatched original out of the current code display", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_input: string, init?: RequestInit) =>
      Promise.resolve(init?.method === "PUT"
        ? Response.json({ error: "join_code_mismatch" }, { status: 409 })
        : Response.json({ joinCode: null })),
    ));
    render(<InviteSharing choirId="drive" choirName="示例云盘" />);
    fireEvent.change(await screen.findByRole("textbox", { name: "邀请码" }), { target: { value: "ABCDEFGH" } });
    fireEvent.click(screen.getByRole("button", { name: "保存原邀请码" }));
    expect(await screen.findByRole("status")).toHaveTextContent("输入的原码与当前有效邀请码不一致。");
    expect(screen.queryByRole("img", { name: "示例云盘邀请二维码" })).not.toBeInTheDocument();
  });

  it("retries a read failure without treating it as a missing original", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ joinCode: "ABCDEFGH" }));
    vi.stubGlobal("fetch", fetchMock);
    render(<InviteSharing choirId="drive" choirName="示例云盘" />);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("暂时无法读取邀请码"));
    expect(screen.queryByRole("button", { name: "保存原邀请码" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "轮换邀请码" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByRole("img", { name: "示例云盘邀请二维码" })).toHaveTextContent("ABCD–EFGH");
  });
});


it("keeps the invitation visible while authority is paused and waits before reading again", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ joinCode: "ABCDEFGH" }));
  vi.stubGlobal("fetch", fetch);
  const view = render(<InviteSharing choirId="drive" choirName="示例云盘" />);
  const card = await screen.findByRole("img", { name: "示例云盘邀请二维码" });
  view.rerender(<InviteSharing choirId="drive" choirName="示例云盘" writable={false} />);
  expect(card).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "轮换邀请码" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "复制邀请码" })).toBeDisabled();
  expect(fetch).toHaveBeenCalledTimes(1);
  fetch.mockResolvedValue(Response.json({ joinCode: "ABCDEFGH" }));
  view.rerender(<InviteSharing choirId="drive" choirName="示例云盘" />);
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  expect(card).toBeInTheDocument();
});


it.each([401, 403, 404, 503])("distinguishes definitive %i denial from a transient error after resuming invitation reads", async status => {
  let denied = false;
  vi.stubGlobal("fetch", vi.fn(async () => denied ? new Response(null, { status }) : Response.json({ joinCode: "ABCDEFGH" })));
  const view = render(<InviteSharing choirId="drive" choirName="示例云盘" />);
  const card = await screen.findByRole("img", { name: "示例云盘邀请二维码" });
  view.rerender(<InviteSharing choirId="drive" choirName="示例云盘" writable={false} />);
  denied = true;
  view.rerender(<InviteSharing choirId="drive" choirName="示例云盘" />);
  await screen.findByText(status === 401 ? "登录已失效，请重新登录后再试。" : status === 403 ? "你没有操作此设置的权限，请联系云盘拥有者。" : "暂时无法读取邀请码，请重试。");
  if (status === 503) expect(card).toBeInTheDocument();
  else {
    expect(card).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "复制邀请码" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "轮换邀请码" })).toBeDisabled();
  }
});
