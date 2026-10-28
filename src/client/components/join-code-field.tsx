import { useLayoutEffect, useRef, useState } from "react";
import { Input, Label, TextField } from "react-aria-components";

import {
  JOIN_CODE_GROUP_LENGTH,
  JOIN_CODE_LENGTH,
  normalizeJoinCodeInput,
} from "./join-code";

// Preserve ASCII letter case, but use the same accepted characters and length
// as the business value. Hidden invalid/overflow text must not consume edits.
function cleanJoinCodeDraft(value: string) {
  return Array.from(value, character => {
    const normalized = normalizeJoinCodeInput(character);
    return /^[a-z]$/.test(character) ? normalized.toLowerCase() : normalized;
  }).join("").slice(0, JOIN_CODE_LENGTH);
}

export function JoinCodeField(props: {
  value: string;
  onChange: (value: string) => void;
  onCompositionChange?: (composing: boolean) => void;
  autoFocus?: boolean;
  isReadOnly?: boolean;
}) {
  // Track the last published value separately so a parent's normalized echo
  // never replaces the native draft or destroys the IME composition range.
  const [draft, setDraft] = useState({ raw: props.value, value: props.value });
  const composing = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingSelection = useRef<{ raw: string; start: number; end: number; direction: "forward" | "backward" | "none" } | null>(null);
  if (props.value !== draft.value) {
    setDraft({ raw: props.value, value: props.value });
  }

  useLayoutEffect(() => {
    const selection = pendingSelection.current;
    pendingSelection.current = null;
    if (selection && inputRef.current?.value === selection.raw) {
      inputRef.current.setSelectionRange(selection.start, selection.end, selection.direction);
    }
  });

  function updateDraft(raw: string) {
    const cleaned = composing.current ? raw : cleanJoinCodeDraft(raw);
    const input = inputRef.current;
    if (cleaned !== raw && input && input.selectionStart !== null && input.selectionEnd !== null) {
      pendingSelection.current = {
        raw: cleaned,
        start: cleanJoinCodeDraft(raw.slice(0, input.selectionStart)).length,
        end: cleanJoinCodeDraft(raw.slice(0, input.selectionEnd)).length,
        direction: input.selectionDirection ?? "none",
      };
    }
    const value = composing.current ? props.value : normalizeJoinCodeInput(cleaned);
    setDraft({ raw: cleaned, value });
    if (value !== props.value) props.onChange(value);
  }

  const activeIndex = Math.min(props.value.length, JOIN_CODE_LENGTH - 1);

  return (
    <TextField
      className="join-code-field"
      isRequired
      isReadOnly={props.isReadOnly}
      value={draft.raw}
      onChange={updateDraft}
    >
      <Label>邀请码</Label>
      <div className="join-code-control">
        <Input
          ref={inputRef}
          className="join-code-input"
          aria-label="邀请码"
          autoFocus={props.autoFocus}
          autoCapitalize="characters"
          autoComplete="off"
          maxLength={32}
          spellCheck={false}
          onCompositionStart={() => {
            composing.current = true;
            props.onCompositionChange?.(true);
          }}
          onCompositionEnd={(event) => {
            composing.current = false;
            updateDraft(event.currentTarget.value);
            props.onCompositionChange?.(false);
          }}
        />
        <div className="join-code-slots" aria-hidden="true">
          <CodeGroup
            value={props.value}
            offset={0}
            activeIndex={activeIndex}
          />
          <span className="join-code-separator">–</span>
          <CodeGroup
            value={props.value}
            offset={JOIN_CODE_GROUP_LENGTH}
            activeIndex={activeIndex}
          />
        </div>
      </div>
    </TextField>
  );
}

function CodeGroup(props: {
  value: string;
  offset: number;
  activeIndex: number;
}) {
  return (
    <span className="join-code-group">
      {Array.from({ length: JOIN_CODE_GROUP_LENGTH }, (_, groupIndex) => {
        const index = props.offset + groupIndex;
        return (
          <span
            className="join-code-slot"
            data-active={index === props.activeIndex || undefined}
            data-filled={Boolean(props.value[index]) || undefined}
            key={index}
          >
            {props.value[index] ?? ""}
          </span>
        );
      })}
    </span>
  );
}
