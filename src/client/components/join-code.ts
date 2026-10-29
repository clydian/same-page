export const JOIN_CODE_LENGTH = 8;
// Preserve UTF-16 offsets for the native input's selection API while ignoring
// only known presentation separators. Invalid characters remain editable.
export function getJoinCodeCharacters(value: string) {
  const characters: { text: string; start: number; end: number }[] = [];
  let offset = 0;
  for (const text of value) {
    if (!/[\s\u2013-]/u.test(text)) characters.push({ text, start: offset, end: offset + text.length });
    offset += text.length;
  }
  return characters;
}

// Parsing never changes the editing draft. Only known presentation separators
// are ignored; invalid and excess characters are not deleted or truncated.
export function parseJoinCodeInput(value: string): { code: string | null; error: string | null; length: number } {
  const characters = getJoinCodeCharacters(value);
  const compact = characters.map(character => character.text).join("");
  const code = compact.toUpperCase();
  const length = characters.length;
  if (/[IO01]/.test(code)) return { code: null, error: "邀请码不含 I、O、0、1，请核对后修改。", length };
  if (/[^A-HJ-NP-Z2-9]/i.test(compact)) return { code: null, error: "包含中文或其他字符，请核对邀请码中的英文字母和数字。", length };
  if (length > JOIN_CODE_LENGTH) return { code: null, error: "邀请码为 8 位，请核对多出的字符。", length };
  return { code: length === JOIN_CODE_LENGTH ? code : null, error: null, length };
}
