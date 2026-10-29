import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { JoinCodeField } from "./join-code-field";
import { parseJoinCodeInput } from "./join-code";

describe("join code parsing", () => {
  it("accepts case and known presentation separators without changing the draft", () => {
    expect(parseJoinCodeInput("ab cd – efgh")).toEqual({ code: "ABCDEFGH", error: null, length: 8 });
    expect(parseJoinCodeInput("ab23")).toEqual({ code: null, error: null, length: 4 });
  });

  it.each(["ABIO2345", "AB012345", "你好234567", "ABCDEFGHJKLM", "AB_CD234", "ß234567"])("rejects the complete invalid draft %s instead of shortening it", value => {
    const parsed = parseJoinCodeInput(value);
    expect(parsed.code).toBeNull();
    expect(parsed.error).not.toBeNull();
  });
});

describe("JoinCodeField", () => {
  it("normalizes presentation separators without removing significant characters", () => {
    render(<FieldHarness />);
    const input = screen.getByRole("textbox", { name: "邀请码" });
    fireEvent.change(input, { target: { value: "ab cd - efgh" } });
    expect(input).toHaveValue("abcdefgh");
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(screen.getByTestId("raw-value")).toHaveTextContent("abcdefgh");
    expect(document.querySelectorAll(".join-code-slot")).toHaveLength(8);
    expect(document.querySelector(".join-code-slots")).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByText(/8 位字母或数字/)).not.toBeInTheDocument();
  });

  it("immediately publishes composition text while withholding submission and validation errors", () => {
    render(<FieldHarness />);
    const input = screen.getByRole("textbox", { name: "邀请码" });
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "oiu23" } });
    expect(input).toHaveValue("oiu23");
    expect(Array.from(document.querySelectorAll(".join-code-slot"), slot => slot.textContent).join("")).toBe("oiu23");
    expect(screen.getByTestId("raw-value")).toHaveTextContent("oiu23");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "提交" })).toBeDisabled();
    fireEvent.compositionEnd(input, { data: "oiu23" });
    expect(input).toHaveValue("oiu23");
    expect(screen.getByRole("alert")).toHaveTextContent("不含 I、O、0、1");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: "提交" })).toBeDisabled();
  });

  it("preserves Chinese candidates and digits instead of silently leaving only digits", () => {
    render(<FieldHarness />);
    const input = screen.getByRole("textbox", { name: "邀请码" });
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "ab23" } });
    fireEvent.change(input, { target: { value: "阿波23" } });
    fireEvent.compositionEnd(input, { data: "阿波23" });
    expect(input).toHaveValue("阿波23");
    expect(screen.getByRole("alert")).toHaveTextContent("包含中文或其他字符");
  });

  it("caps committed input at eight positions and preserves middle selection", () => {
    render(<FieldHarness />);
    const input = screen.getByRole("textbox", { name: "邀请码" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "ABCDEFGHJKLM" } });
    expect(input).toHaveValue("ABCDEFGH");
    expect(screen.getByRole("status", { name: "截断提示" })).toHaveTextContent("仅保留前八位");
    fireEvent.change(input, { target: { value: "Ab23", selectionStart: 2, selectionEnd: 2 } });
    expect(input).toHaveValue("Ab23");
    expect(input.selectionStart).toBe(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("leaves the composition range untouched until commit, then caps Chinese as well", () => {
    render(<FieldHarness />);
    const input = screen.getByRole("textbox", { name: "邀请码" });
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "你好世界测试中文更多23" } });
    expect(input).toHaveValue("你好世界测试中文更多23");
    expect(screen.getByLabelText("完整输入内容")).toHaveTextContent("你好世界测试中文更多23");
    expect(document.querySelectorAll(".join-code-slot")).toHaveLength(8);
    expect(document.querySelector("[data-expanded]")).toBeNull();
    fireEvent.compositionEnd(input);
    expect(input).toHaveValue("你好世界测试中文");
    expect(screen.getByRole("status", { name: "截断提示" })).toHaveTextContent("仅保留前八位");
    expect(screen.getByRole("alert")).toHaveTextContent("包含中文或其他字符");
    expect(screen.getByRole("button", { name: "提交" })).toBeDisabled();
    // A browser's trailing input event must not undo the cap or its notice.
    fireEvent.change(input, { target: { value: "你好世界测试中文更多23" } });
    expect(input).toHaveValue("你好世界测试中文");
  });

  it("does not use an earlier valid code after the current draft becomes invalid", () => {
    render(<FieldHarness />);
    const input = screen.getByRole("textbox", { name: "邀请码" });
    fireEvent.change(input, { target: { value: "ABCD2345" } });
    expect(screen.getByRole("button", { name: "提交" })).toBeEnabled();
    fireEvent.change(input, { target: { value: "ABIO2345" } });
    expect(input).toHaveValue("ABIO2345");
    expect(screen.getByRole("button", { name: "提交" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "清空" }));
    expect(input).toHaveValue("");
  });
});

function FieldHarness() {
  const [value, setValue] = useState("");
  const [composing, setComposing] = useState(false);
  return <>
    <JoinCodeField value={value} onChange={setValue} onCompositionChange={setComposing} />
    <output data-testid="raw-value">{value}</output>
    <button disabled={composing || !parseJoinCodeInput(value).code}>提交</button>
    <button onClick={() => setValue("")}>清空</button>
  </>;
}
