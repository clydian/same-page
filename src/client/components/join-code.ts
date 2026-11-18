import { getCurrentLocale, getMessages, type AppLocale } from "../../i18n";

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
export function parseJoinCodeInput(value: string, locale: AppLocale = getCurrentLocale()): { code: string | null; error: string | null; length: number } {
  const characters = getJoinCodeCharacters(value);
  const compact = characters.map(character => character.text).join("");
  const t = getMessages(locale, "common");
  const code = compact.toUpperCase();
  const length = characters.length;
  if (/[IO01]/.test(code)) return { code: null, error: t("inviteInvalidLookalikes"), length };
  if (/[^A-HJ-NP-Z2-9]/i.test(compact)) return { code: null, error: t("inviteInvalidCharacters"), length };
  if (length > JOIN_CODE_LENGTH) return { code: null, error: t("inviteTooLong"), length };
  return { code: length === JOIN_CODE_LENGTH ? code : null, error: null, length };
}
