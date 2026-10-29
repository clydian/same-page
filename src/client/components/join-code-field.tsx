import { useLayoutEffect, useRef, useState } from "react";
import { FieldError, Input, Label, TextField } from "react-aria-components";

import { JOIN_CODE_LENGTH, getJoinCodeCharacters, parseJoinCodeInput } from "./join-code";

export function JoinCodeField(props: {
  value: string;
  onChange: (value: string) => void;
  onCompositionChange?: (composing: boolean) => void;
  autoFocus?: boolean;
  isReadOnly?: boolean;
}) {
  const [composing, setComposing] = useState(false);
  const composingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingSelection = useRef<{ start: number; end: number; direction: "forward" | "backward" | "none" } | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const parsed = parseJoinCodeInput(props.value);
  const error = composing ? null : parsed.error;
  const characters = getJoinCodeCharacters(props.value);
  const pointerSelection = useRef<{ id: number; anchor: number } | null>(null);
  const cursorIndex = characters.findIndex(character => character.start >= selection.end);
  const caretIndex = cursorIndex < 0 ? characters.length : cursorIndex;

  function readSelection(input: HTMLInputElement) {
    setSelection({ start: input.selectionStart ?? 0, end: input.selectionEnd ?? 0 });
  }

  function changeDraft(value: string) {
    if (inputRef.current) readSelection(inputRef.current);
    if (composingRef.current) {
      props.onChange(value);
      return;
    }
    // Presentation separators do not consume a code position. Never remove
    // invalid characters to make a different, apparently valid invitation.
    const characters = getJoinCodeCharacters(value);
    const kept = characters.slice(0, JOIN_CODE_LENGTH);
    const nextValue = kept.map(character => character.text).join("");
    if (characters.length > JOIN_CODE_LENGTH) setTruncated(true);
    else if (value !== props.value) setTruncated(false);
    if (nextValue !== value) {
      const input = inputRef.current;
      const mapPosition = (position: number) => kept.filter(character => character.end <= position).reduce((length, character) => length + character.text.length, 0);
      pendingSelection.current = {
        start: mapPosition(input?.selectionStart ?? value.length),
        end: mapPosition(input?.selectionEnd ?? value.length),
        direction: input?.selectionDirection ?? "none",
      };
    }
    props.onChange(nextValue);
  }

  useLayoutEffect(() => {
    if (pendingSelection.current !== null && inputRef.current) {
      const { start, end, direction } = pendingSelection.current;
      inputRef.current.setSelectionRange(start, end, direction);
      readSelection(inputRef.current);
      pendingSelection.current = null;
    }
  });

  function positionAt(clientX: number, control: HTMLDivElement) {
    const bounds = control.getBoundingClientRect();
    const position = Math.max(0, (clientX - bounds.left) / (bounds.width / JOIN_CODE_LENGTH));
    const character = characters[Math.floor(position)];
    return character ? position % 1 < 0.5 ? character.start : character.end : props.value.length;
  }

  function selectRange(anchor: number, position: number) {
    const input = inputRef.current;
    if (!input) return;
    input.setSelectionRange(Math.min(anchor, position), Math.max(anchor, position), position < anchor ? "backward" : "forward");
    readSelection(input);
  }

  return (
    <TextField
      className="join-code-field"
      isRequired
      validationBehavior="aria"
      isReadOnly={props.isReadOnly}
      isInvalid={Boolean(error)}
      value={props.value}
      onChange={changeDraft}
    >
      <Label>邀请码</Label>
      <div className="join-code-control"
        onPointerDown={event => {
          if (props.isReadOnly || composingRef.current || event.button !== 0) return;
          event.preventDefault();
          inputRef.current?.focus();
          const position = positionAt(event.clientX, event.currentTarget);
          const input = inputRef.current;
          const anchor = event.shiftKey ? (input?.selectionDirection === "backward" ? input.selectionEnd : input?.selectionStart) ?? position : position;
          pointerSelection.current = { id: event.pointerId, anchor };
          event.currentTarget.setPointerCapture(event.pointerId);
          selectRange(anchor, position);
        }}
        onPointerMove={event => {
          const pointer = pointerSelection.current;
          if (!pointer || pointer.id !== event.pointerId || composingRef.current) return;
          selectRange(pointer.anchor, positionAt(event.clientX, event.currentTarget));
        }}
        onPointerUp={() => { pointerSelection.current = null; }}
        onPointerCancel={() => { pointerSelection.current = null; }}
        onDoubleClick={() => {
          if (!composingRef.current) selectRange(0, props.value.length);
        }}
      >
        <div className="join-code-slots" aria-hidden="true">
          {Array.from({ length: JOIN_CODE_LENGTH }, (_, index) => {
            const character = characters[index];
            return <span className="join-code-slot" key={index}
              data-selected={Boolean(character && character.start < selection.end && character.end > selection.start) || undefined}
              data-caret={selection.start === selection.end && (index === caretIndex || index === JOIN_CODE_LENGTH - 1 && caretIndex >= JOIN_CODE_LENGTH) || undefined}
              data-after={caretIndex >= JOIN_CODE_LENGTH || undefined}
            >{character?.text}</span>;
          })}
        </div>
        <Input
          ref={inputRef}
          className="join-code-input"
          aria-label="邀请码"
          autoFocus={props.autoFocus}
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          inputMode="text"
          spellCheck={false}
          onSelect={event => readSelection(event.currentTarget)}
          onFocus={event => readSelection(event.currentTarget)}
          onCompositionStart={() => {
            composingRef.current = true;
            setTruncated(false);
            setComposing(true);
            props.onCompositionChange?.(true);
          }}
          onCompositionEnd={event => {
            composingRef.current = false;
            changeDraft(event.currentTarget.value);
            setComposing(false);
            props.onCompositionChange?.(false);
          }}
        />
      </div>
      {characters.length > JOIN_CODE_LENGTH && <output className="join-code-draft" aria-label="完整输入内容">{props.value}</output>}
      {truncated && <span className="join-code-error" role="status" aria-label="截断提示">仅保留前八位。</span>}
      {error && <FieldError className="join-code-error"><span role="alert">{error}</span></FieldError>}
    </TextField>
  );
}
