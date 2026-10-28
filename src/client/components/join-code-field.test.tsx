import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { JoinCodeField } from "./join-code-field";
import { normalizeJoinCodeInput } from "./join-code";

describe("JoinCodeField", () => {
  it("normalizes case, separators, ambiguous characters, and length", () => {
    expect(normalizeJoinCodeInput("abci-0oef 2345")).toBe("ABCEF234");
    expect(normalizeJoinCodeInput("ABCDEFGHJKLM")).toBe("ABCDEFGH");
  });

  it("uses one labelled input while presenting eight decorative slots", () => {
    render(<FieldHarness />);

    const input = screen.getByRole("textbox", { name: "邀请码" });
    expect(screen.getAllByRole("textbox")).toHaveLength(1);

    fireEvent.change(input, { target: { value: "ab cd - efgh" } });

    expect(input).toHaveValue("abcdefgh");
    expect(screen.getByTestId("code-value")).toHaveTextContent("ABCDEFGH");
    expect(slotText()).toBe("ABCDEFGH");
    expect(document.querySelector(".join-code-slots")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("retains the native draft and selection when normalized values echo back", () => {
    render(<FieldHarness initialValue="AC" />);
    const input = screen.getByRole("textbox", { name: "邀请码" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "AbC", selectionStart: 2, selectionEnd: 2 } });
    expect(input).toHaveValue("AbC");
    expect(input.selectionStart).toBe(2);
    expect(slotText()).toBe("ABC");
  });

  it("keeps composition updates out of the committed code until confirmation", () => {
    render(<FieldHarness initialValue="ABCDEFGH" />);
    const input = screen.getByRole("textbox", { name: "邀请码" });
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "a" } });
    fireEvent.change(input, { target: { value: "as" } });
    expect(input).toHaveValue("as");
    expect(slotText()).toBe("ABCDEFGH");
    expect(screen.getByRole("button", { name: "提交" })).toBeDisabled();
    fireEvent.compositionEnd(input, { data: "as" });
    expect(input).toHaveValue("as");
    expect(slotText()).toBe("AS");
    expect(screen.getByRole("button", { name: "提交" })).toBeEnabled();
    // Some browsers deliver another input after compositionend.
    fireEvent.change(input, { target: { value: "as" } });
    expect(slotText()).toBe("AS");
  });

  it("handles cancellation and committed Chinese text without extracting stale pinyin", () => {
    render(<FieldHarness initialValue="AB" />);
    const input = screen.getByRole("textbox", { name: "邀请码" });
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "ABas" } });
    fireEvent.change(input, { target: { value: "AB" } });
    fireEvent.compositionEnd(input, { data: "" });
    expect(slotText()).toBe("AB");
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "AB你" } });
    fireEvent.compositionEnd(input, { data: "你" });
    expect(input).toHaveValue("AB");
    expect(slotText()).toBe("AB");
  });

  it("removes invisible overflow and invalid text so deletion and typing remain usable", () => {
    render(<FieldHarness />);
    const input = screen.getByRole("textbox", { name: "邀请码" });
    fireEvent.change(input, { target: { value: "ABCDEFGHJKLMNPQR" } });
    expect(input).toHaveValue("ABCDEFGH");
    fireEvent.change(input, { target: { value: "你".repeat(32) } });
    expect(input).toHaveValue("");
    fireEvent.change(input, { target: { value: "a" } });
    expect(slotText()).toBe("A");
  });

  it("maps the caret across removed characters when pasting in the middle", () => {
    render(<FieldHarness initialValue="ABGH" />);
    const input = screen.getByRole("textbox", { name: "邀请码" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "AB c-d GH", selectionStart: 7, selectionEnd: 7 } });
    expect(input).toHaveValue("ABcdGH");
    expect(input.selectionStart).toBe(4);
    expect(input.selectionEnd).toBe(4);
    expect(slotText()).toBe("ABCDGH");
  });

  it("accepts external replacements and clears a dirty draft", () => {
    render(<FieldHarness />);
    const input = screen.getByRole("textbox", { name: "邀请码" });
    fireEvent.change(input, { target: { value: "as" } });
    fireEvent.click(screen.getByRole("button", { name: "替换" }));
    expect(input).toHaveValue("EFGH2345");
    expect(slotText()).toBe("EFGH2345");
    fireEvent.click(screen.getByRole("button", { name: "清空" }));
    expect(input).toHaveValue("");
    expect(slotText()).toBe("");
  });
});

function slotText() {
  return Array.from(document.querySelectorAll(".join-code-slot"), slot => slot.textContent).join("");
}

function FieldHarness(props: { initialValue?: string }) {
  const [value, setValue] = useState(props.initialValue ?? "");
  const [composing, setComposing] = useState(false);
  return <>
    <JoinCodeField value={value} onChange={setValue} onCompositionChange={setComposing} />
    <output data-testid="code-value">{value}</output>
    <button disabled={composing}>提交</button>
    <button onClick={() => setValue("EFGH2345")}>替换</button>
    <button onClick={() => setValue("")}>清空</button>
  </>;
}
