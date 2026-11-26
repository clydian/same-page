import { registerJoinKeyboardTests } from "./join-keyboard-cases.mjs";

// Blocking: the share link and both join dialogs must remain usable with a keyboard.
registerJoinKeyboardTests([["home", 390, 844], ["invite", 390, 844], ["library", 390, 844]]);
