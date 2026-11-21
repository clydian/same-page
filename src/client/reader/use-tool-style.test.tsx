import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import { defaultToolStyle } from "../annotations/tool-style";
import { useToolStyle } from "./use-tool-style";
beforeEach(() => localStorage.clear());
it("upgrades only legacy pen pressure preference and keeps an explicit new uniform choice across reloads", () => {
  const key = "note-tool-style:owner:ink";
  const legacy = { ...defaultToolStyle("ink"), pressureMode: "uniform", strokeWidth: .012, opacity: .7 };
  localStorage.setItem(key, JSON.stringify(legacy));
  localStorage.setItem("note-tool-style:owner:highlighter", JSON.stringify(defaultToolStyle("highlighter")));
  localStorage.setItem("note-tool-color:owner:ink", "#123456");
  const first = renderHook(() => useToolStyle("owner", "ink"));
  expect(first.result.current.style).toEqual({ ...legacy, pressureMode: "pressure" });
  act(() => first.result.current.setStyle({ ...first.result.current.style, pressureMode: "uniform" }));
  first.unmount();
  const next = renderHook(() => useToolStyle("owner", "ink"));
  expect(next.result.current.style).toEqual(legacy);
  expect(localStorage.getItem("note-tool-color:owner:ink")).toBe("#123456");
  expect(JSON.parse(localStorage.getItem("note-tool-style:owner:highlighter")!)).toEqual(defaultToolStyle("highlighter"));
});
it("defaults new users to pressure and isolates owners", () => {
  const view = renderHook(({ owner, tool }) => useToolStyle(owner, tool), { initialProps: { owner: "new", tool: "ink" as "ink" | "highlighter" } });
  expect(view.result.current.style.pressureMode).toBe("pressure");
  act(() => view.result.current.setStyle({ ...view.result.current.style, pressureMode: "uniform" }));
  view.rerender({ owner: "other", tool: "ink" });
  expect(view.result.current.style.pressureMode).toBe("pressure");
  view.rerender({ owner: "other", tool: "highlighter" });
  expect(view.result.current.style.pressureMode).toBe("uniform");
});
