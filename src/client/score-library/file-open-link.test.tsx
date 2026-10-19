import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import { FileOpenLink } from "./file-open-link";

let now = 0;
beforeEach(() => { now = 0; vi.spyOn(performance, "now").mockImplementation(() => now); });
function Location() { return <output>{useLocation().pathname}</output>; }
function fixture(to = "/score", onClick = vi.fn()) {
  return <MemoryRouter><FileOpenLink to={to} onClick={onClick}>文件</FileOpenLink><Location /></MemoryRouter>;
}
function pointer(target: Element, type: string, init: PointerEventInit = {}) {
  const event = new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: "touch", pointerId: 1, isPrimary: true, clientX: 20, clientY: 20, ...init });
  fireEvent(target, event);
  return event;
}
function tap(target: Element) {
  pointer(target, "pointerdown"); now += 40; pointer(target, "pointerup");
  fireEvent.click(target, { detail: 1 });
}

it.each(["context before cancel", "context after release", "no context event"])("withdraws a held touch with %s, then accepts the next tap", order => {
  const open = vi.fn(); render(fixture("/score", open));
  const file = screen.getByRole("link");
  pointer(file, "pointerdown");
  expect(file).toHaveAttribute("data-touch-active");
  now = 700;
  if (order === "context before cancel") {
    expect(pointer(file, "contextmenu").defaultPrevented).toBe(true);
    pointer(file, "pointercancel");
  } else {
    pointer(file, "pointerup");
    if (order === "context after release") expect(pointer(file, "contextmenu").defaultPrevented).toBe(true);
  }
  expect(file).not.toHaveAttribute("data-touch-active");
  fireEvent.click(file, { detail: 1 });
  expect(open).not.toHaveBeenCalled();
  expect(screen.getByRole("status")).toHaveTextContent(/^\/$/);
  tap(file);
  expect(open).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("status")).toHaveTextContent("/score");
});

it("does not swallow a fresh tap when the browser emitted no trailing click", () => {
  const open = vi.fn(); render(fixture("/score", open)); const file = screen.getByRole("link");
  pointer(file, "pointerdown"); now = 800; pointer(file, "pointercancel");
  tap(file);
  expect(open).toHaveBeenCalledTimes(1);
});

it.each(["move", "second contact", "cancel", "release outside tap distance"])("withdraws %s without preventing native pointer handling", reason => {
  const open = vi.fn(); render(fixture("/score", open)); const file = screen.getByRole("link");
  expect(pointer(file, "pointerdown").defaultPrevented).toBe(false);
  if (reason === "move") expect(pointer(file, "pointermove", { clientY: 70 }).defaultPrevented).toBe(false);
  if (reason === "second contact") {
    pointer(file, "pointerdown", { pointerId: 2, isPrimary: false });
    pointer(file, "pointerup", { pointerId: 2, isPrimary: false });
  }
  pointer(file, reason === "cancel" ? "pointercancel" : "pointerup", { clientY: reason === "release outside tap distance" ? 50 : 20 });
  fireEvent.click(file, { detail: 1 });
  expect(open).not.toHaveBeenCalled();
  tap(file);
  expect(open).toHaveBeenCalledTimes(1);
});

it("preserves a short tap even when its compatibility click is delayed", () => {
  const open = vi.fn(); render(fixture("/score", open)); const file = screen.getByRole("link");
  pointer(file, "pointerdown"); now = 200; pointer(file, "pointerup"); now = 700;
  fireEvent.click(file, { detail: 1 });
  expect(open).toHaveBeenCalledTimes(1);
});

it("withdraws a secondary touch that starts on the link while the first finger is elsewhere", () => {
  const open = vi.fn(); render(fixture("/score", open)); const file = screen.getByRole("link");
  pointer(file, "pointerdown", { pointerId: 2, isPrimary: false });
  pointer(file, "pointerup", { pointerId: 2, isPrimary: false });
  fireEvent.click(file, { detail: 1 });
  expect(open).not.toHaveBeenCalled();
  tap(file); expect(open).toHaveBeenCalledTimes(1);
});

it("does not run an opening callback when another handler already cancelled activation", () => {
  const open = vi.fn();
  render(<MemoryRouter><div onClickCapture={event => event.preventDefault()}><FileOpenLink to="/score" onClick={open}>文件</FileOpenLink></div></MemoryRouter>);
  fireEvent.click(screen.getByRole("link"));
  expect(open).not.toHaveBeenCalled();
});

it("does not let an older contact's delayed menu withdraw a fresh touch or mouse click", () => {
  const open = vi.fn(); render(fixture("/score", open)); const file = screen.getByRole("link");
  pointer(file, "pointerdown"); pointer(file, "pointercancel");
  pointer(file, "pointerdown", { pointerId: 2 });
  expect(pointer(file, "contextmenu", { pointerId: 1 }).defaultPrevented).toBe(true);
  pointer(file, "pointerup", { pointerId: 2 }); fireEvent.click(file, { detail: 1 });
  expect(open).toHaveBeenCalledTimes(1);
  pointer(file, "pointerdown", { pointerType: "mouse", pointerId: 3 });
  pointer(file, "contextmenu", { pointerId: 2 });
  fireEvent.click(file, { detail: 1 }); expect(open).toHaveBeenCalledTimes(2);
});

it.each(["mouse", "pen", "unknown", "keyboard"])("preserves %s context menus and activation after touch", source => {
  const open = vi.fn(); render(fixture("/score", open)); const file = screen.getByRole("link");
  pointer(file, "pointerdown"); now = 600; pointer(file, "pointerup");
  const type = source === "unknown" || source === "keyboard" ? "" : source;
  if (source === "keyboard") fireEvent.keyDown(file, { key: "ContextMenu" });
  else pointer(file, "pointerdown", { pointerType: type });
  expect(file).not.toHaveAttribute("data-touch-active");
  const context = source === "unknown" ? new MouseEvent("contextmenu", { bubbles: true, cancelable: true })
    : new PointerEvent("contextmenu", { bubbles: true, cancelable: true, pointerType: type, pointerId: source === "keyboard" ? -1 : 2 });
  fireEvent(file, context);
  expect(context.defaultPrevented).toBe(false);
  fireEvent.click(file, { detail: source === "keyboard" ? 0 : 1 });
  expect(open).toHaveBeenCalledTimes(1);
});

it("keeps modified link clicks and keyboard/assistive activation", () => {
  const open = vi.fn(); render(fixture("/score", open)); const file = screen.getByRole("link");
  pointer(file, "pointerdown"); now = 700; pointer(file, "pointerup");
  fireEvent.click(file, { detail: 1, ctrlKey: true });
  fireEvent.click(file, { detail: 0 });
  expect(open).toHaveBeenCalledTimes(2);
  expect(file).toHaveAttribute("href", "/score");
});

it("retains withdrawal through rerenders, fences a changed destination and releases state on remount", () => {
  const open = vi.fn(); const view = render(fixture("/score", open)); let file = screen.getByRole("link");
  pointer(file, "pointerdown"); now = 50;
  view.rerender(fixture("/other", open));
  fireEvent.click(file, { detail: 1 });
  expect(open).not.toHaveBeenCalled();
  tap(file);
  expect(open).toHaveBeenCalledTimes(1);
  pointer(file, "pointerdown"); now += 700; pointer(file, "pointerup");
  view.rerender(fixture("/other", open));
  fireEvent.click(file, { detail: 1 });
  expect(open).toHaveBeenCalledTimes(1);
  view.unmount();
  render(fixture("/score", open)); file = screen.getByRole("link");
  tap(file);
  expect(open).toHaveBeenCalledTimes(2);
});
