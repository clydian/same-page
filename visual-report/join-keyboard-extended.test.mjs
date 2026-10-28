import { registerJoinKeyboardTests } from "./join-keyboard-cases.mjs";

// Post-beta: alternate page composition and repeated landscape geometry changes.
// The gate already covers page recovery in auth and both join overlay entrances.
registerJoinKeyboardTests([["first-drive", 390, 844], ["landscape", 844, 390]]);
