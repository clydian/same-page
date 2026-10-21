import { expect, it } from "vitest";
import { DriveHistory } from "./drive-history";

it("skips retired drive tasks in both directions but retains current-drive parents", () => {
  const history = new DriveHistory();
  history.observe("home", "/drives", "POP");
  history.observe("a", "/choirs/a", "PUSH");
  history.observe("settings", "/choirs/a/settings", "PUSH");
  history.observe("a2", "/choirs/a", "PUSH");
  history.observe("b", "/choirs/b", "REPLACE");
  expect(history.obsolete("settings", "/choirs/a/settings", "POP")).toBe(true);
  expect(history.skip("settings")).toBe(-2);
  history.observe("home", "/drives", "POP");
  expect(history.skip("a")).toBe(2);
  history.observe("b", "/choirs/b", "POP");
  history.observe("bs", "/choirs/b/settings", "PUSH");
  expect(history.parent("/choirs/b")).toBe(-1);
  expect(history.obsolete("b", "/choirs/b", "POP")).toBe(false);
});

it("does not revive an earlier context after explicitly switching back to the same drive", () => {
  const history = new DriveHistory();
  history.observe("a", "/choirs/a", "POP");
  history.observe("as", "/choirs/a/settings", "PUSH");
  history.observe("a2", "/choirs/a", "PUSH");
  history.observe("b", "/choirs/b", "REPLACE");
  history.observe("a3", "/choirs/a", "REPLACE");
  expect(history.obsolete("as", "/choirs/a/settings", "POP")).toBe(true);
  expect(history.obsolete("new-deep-link", "/choirs/b/scores/one", "PUSH")).toBe(false);
  expect(history.skip("unknown-legacy-entry")).toBeNull();
});

it("keeps retired contexts across a refresh without persisting query credentials", () => {
  sessionStorage.clear();
  const history = new DriveHistory();
  history.observe("a", "/choirs/a", "POP");
  history.observe("as", "/choirs/a/settings?secret=never-store#invite", "PUSH");
  history.observe("a2", "/choirs/a", "PUSH");
  history.observe("b", "/choirs/b", "REPLACE");
  history.observe("a3", "/choirs/a", "REPLACE");
  const restored = new DriveHistory("a3");
  expect(restored.obsolete("as", "/choirs/a/settings", "POP")).toBe(true);
  expect(sessionStorage.getItem("same-page:drive-history-v1")).not.toContain("secret");
});
