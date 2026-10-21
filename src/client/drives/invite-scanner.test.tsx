import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { InviteScanner } from "./invite-scanner";
import { decodeInviteImage } from "./invite-qr";

vi.mock("./invite-qr", () => ({ decodeInviteQr: vi.fn(async () => null), decodeInviteImage: vi.fn() }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("releases a camera granted after cancellation, without attaching it to a closed scanner", async () => {
  let grant!: (stream: MediaStream) => void;
  const stop = vi.fn();
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn(() => new Promise<MediaStream>(resolve => { grant = resolve; })) } });
  const view = render(<InviteScanner disabled={false} onRead={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "扫一扫" }));
  await waitFor(() => expect(grant).toBeTypeOf("function"));
  view.unmount();
  await act(async () => { grant({ getTracks: () => [{ stop }] } as unknown as MediaStream); });
  expect(stop).toHaveBeenCalledOnce();
});

it("offers a fallback when camera permission is rejected", async () => {
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn(async () => { throw new DOMException("denied", "NotAllowedError"); }) } });
  render(<InviteScanner disabled={false} onRead={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "扫一扫" }));
  expect(await screen.findByRole("status")).toHaveTextContent("无法开启相机");
  expect(screen.getByRole("button", { name: "从相册识别" })).toBeEnabled();
});

it("invalidates an album decode when manual admission disables the scanner, even if that admission later fails", async () => {
  let finish!: (value: string) => void;
  vi.mocked(decodeInviteImage).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const original = vi.fn(), current = vi.fn();
  const view = render(<InviteScanner disabled={false} onRead={original} />);
  fireEvent.change(screen.getByLabelText("选择邀请卡图片"), { target: { files: [new File(["image"], "card.png", { type: "image/png" })] } });
  view.rerender(<InviteScanner disabled onRead={current} />);
  view.rerender(<InviteScanner disabled={false} onRead={current} />);
  await act(async () => finish(`${location.origin}/?join=1#invite=ABCDEFGH`));
  expect(original).not.toHaveBeenCalled(); expect(current).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "从相册识别" })).toBeEnabled();
});

it("reads only this origin's invitation and drops an image result after unmount", async () => {
  const onRead = vi.fn();
  let finishExternalDecode!: (value: string) => void;
  vi.mocked(decodeInviteImage).mockImplementationOnce(() => new Promise(resolve => { finishExternalDecode = resolve; })).mockResolvedValueOnce(`${location.origin}/?join=1#invite=ABCDEFGH`);
  const view = render(<InviteScanner disabled={false} onRead={onRead} />);
  const file = new File(["image"], "card.png", { type: "image/png" });
  fireEvent.change(screen.getByLabelText("选择邀请卡图片"), { target: { files: [file] } });
  expect(screen.getByRole("status")).toHaveTextContent("正在识别邀请卡");
  expect(onRead).not.toHaveBeenCalled();
  await act(async () => finishExternalDecode("https://untrusted.test/?join=1#invite=ABCDEFGH"));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("未识别到本站邀请卡"));
  expect(onRead).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("选择邀请卡图片"), { target: { files: [file] } });
  await waitFor(() => expect(onRead).toHaveBeenCalledWith("ABCDEFGH"));
  let finish!: (value: string) => void;
  vi.mocked(decodeInviteImage).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  fireEvent.change(screen.getByLabelText("选择邀请卡图片"), { target: { files: [file] } });
  view.unmount();
  await act(async () => finish(`${location.origin}/?join=1#invite=ABCDEFGH`));
  expect(onRead).toHaveBeenCalledTimes(1);
});
