import { registerJoinKeyboardTests } from "./join-keyboard-cases.mjs";

// Blocking: both product admission entrances must remain usable with a keyboard.
registerJoinKeyboardTests([["home", 390, 844], ["library", 390, 844]]);
