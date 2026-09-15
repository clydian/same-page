import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { localDatabase } from "../platform/local-database";
import { activateAuthenticatedLocalOwner, authenticatedLocalOwnerKey, createLocalWorkspace } from "../platform/local-workspace";
import { AnnotationEditor } from "./annotation-editor";
import { defaultToolStyle } from "./tool-style";
import { useTextComposition } from "./use-text-composition";

const layerId = "11111111-1111-4111-8111-111111111111";
const otherLayerId = "22222222-2222-4222-8222-222222222222";
let editor: AnnotationEditor;

beforeEach(async () => {
  await localDatabase.open();
  await localDatabase.annotations.clear();
  await activateAuthenticatedLocalOwner("text-user");
  editor = new AnnotationEditor(createLocalWorkspace(authenticatedLocalOwnerKey("text-user"), "drive", "score"));
  editor.begin();
});

function Composer({ pageNumber = 1, activeLayerId = layerId, remember = () => {}, composing = () => {} }: {
  pageNumber?: number;
  activeLayerId?: string;
  remember?: () => void;
  composing?: (active: boolean) => void;
}) {
  const text = useTextComposition({ editor, pageNumber, activeLayerId, editing: true,
    toolStyle: defaultToolStyle("text"), toolColor: "#dc2626", onTextStyleChange: remember, onComposingChange: composing });
  return <>
    <svg aria-label="谱面" onPointerDown={event => text.startPlacement(event, { x: .2, y: .3 })}
      onPointerMove={text.movePlacement} onPointerUp={text.endPlacement} onPointerCancel={text.endPlacement} />
    {text.form}
  </>;
}

function begin(pointerType = "touch") {
  const page = screen.getByLabelText("谱面");
  fireEvent.pointerDown(page, { pointerId: 1, pointerType, clientX: 20, clientY: 30 });
  if (pointerType !== "pen") fireEvent.pointerUp(page, { pointerId: 1, pointerType, clientX: 20, clientY: 30 });
}

it("keeps the original page and layer when inputs change before completion", async () => {
  const remember = vi.fn();
  const replacementRemember = vi.fn();
  const view = render(<Composer remember={remember} />);
  begin();
  fireEvent.change(screen.getByRole("textbox", { name: "笔记文本" }), { target: { value: "原谱原层" } });
  view.rerender(<Composer pageNumber={2} activeLayerId={otherLayerId} remember={replacementRemember} />);
  expect(editor.canNavigate()).toBe(false);
  fireEvent.submit(screen.getByRole("form", { name: "文字输入" }));
  await waitFor(() => expect(screen.queryByRole("textbox")).not.toBeInTheDocument());
  expect(await localDatabase.annotations.toArray()).toEqual([expect.objectContaining({
    layerId, payload: expect.objectContaining({ pageNumber: 1, text: "原谱原层" }),
  })]);
  expect(remember).toHaveBeenCalledOnce();
  expect(replacementRemember).not.toHaveBeenCalled();
  expect(editor.canNavigate()).toBe(true);
});

it("admits one save when completion is requested twice while storage is pending", async () => {
  let complete!: (saved: boolean) => void;
  const saved = new Promise<boolean>(resolve => { complete = resolve; });
  const persist = vi.spyOn(editor, "persist").mockReturnValue(saved);
  render(<Composer />);
  begin();
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "只提交一次" } });
  const form = screen.getByRole("form", { name: "文字输入" });
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(persist).toHaveBeenCalledOnce();
  expect(screen.getByRole("textbox")).toHaveAttribute("readonly");
  expect(editor.canNavigate()).toBe(false);
  await act(async () => { complete(false); });
  expect(screen.getByRole("textbox")).toHaveValue("只提交一次");
  expect(screen.getByRole("textbox")).not.toHaveAttribute("readonly");
});

it.each(["touch", "pen"])("retires a cancelled %s placement without opening on a later release", async pointerType => {
  render(<Composer />);
  const page = screen.getByLabelText("谱面");
  const event = { pointerId: 1, pointerType, clientX: 20, clientY: 30 };
  fireEvent.pointerDown(page, event);
  if (pointerType === "pen") expect(screen.getByRole("textbox")).toHaveFocus();
  fireEvent.pointerCancel(page, event);
  fireEvent.pointerUp(page, event);
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(await localDatabase.annotations.count()).toBe(0);
  expect(editor.canNavigate()).toBe(true);
});

it("does not publish completion or remember defaults after unmount", async () => {
  let complete!: (saved: boolean) => void;
  const saved = new Promise<boolean>(resolve => { complete = resolve; });
  vi.spyOn(editor, "persist").mockReturnValue(saved);
  const remember = vi.fn();
  const composing = vi.fn();
  const view = render(<Composer remember={remember} composing={composing} />);
  begin();
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "旧输入" } });
  fireEvent.submit(screen.getByRole("form", { name: "文字输入" }));
  view.unmount();
  composing.mockClear();
  await act(async () => { complete(true); });
  expect(remember).not.toHaveBeenCalled();
  expect(composing).not.toHaveBeenCalled();
  expect(editor.canNavigate()).toBe(true);
});
