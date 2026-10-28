import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { AppearanceProvider, AppearanceSettings } from "./appearance";
import { clearUserAppearance, defaultAppearance, parseAppearance, readAppearance, saveAppearance } from "./appearance-store";
const identity = vi.hoisted(() => ({ localUserId: "appearance-user", restoring: false }));
vi.mock("../auth/application-identity", () => ({ useApplicationIdentity: () => identity }));
beforeEach(() => { localStorage.clear(); identity.localUserId = "appearance-user"; identity.restoring = false; });
function settings(path = "/user") { return <MemoryRouter initialEntries={[path]}><AppearanceProvider><AppearanceSettings /></AppearanceProvider></MemoryRouter>; }
it("validates stored values and keeps old or malformed storage usable", () => {
  for (const raw of [null, "broken", "null", "{}", '{"interfaceTheme":"other","darkPaper":3,"invertAnnotations":"true"}']) expect(parseAppearance(raw)).toEqual(defaultAppearance);
  expect(parseAppearance('{"interfaceTheme":"dark","lightPaper":"inverted","unknown":true}')).toMatchObject({ interfaceTheme: "dark", lightPaper: "inverted", darkPaper: "soft" });
});
it("switches separate light/dark paper choices live and restores them across mounts", () => {
  const view = render(settings());
  expect(document.documentElement.dataset).toMatchObject({ uiTheme: "light", paperTheme: "original" });
  fireEvent.change(screen.getByLabelText("深色界面下的谱面"), { target: { value: "inverted" } });
  expect(document.documentElement.dataset.paperTheme).toBe("original");
  fireEvent.change(screen.getByLabelText("界面主题"), { target: { value: "dark" } });
  expect(document.documentElement.dataset).toMatchObject({ uiTheme: "dark", paperTheme: "inverted", invertAnnotations: "false" });
  fireEvent.change(screen.getByLabelText("谱面反色时的批注"), { target: { value: "invert" } });
  view.unmount(); render(settings());
  expect(screen.getByLabelText("界面主题")).toHaveValue("dark");
  expect(document.documentElement.dataset.invertAnnotations).toBe("true");
});
it("reacts to system theme and storage events without changing independent paper choices", () => {
  const media = Object.assign(new EventTarget(), { matches: false });
  vi.stubGlobal("matchMedia", () => media);
  render(settings());
  act(() => { media.matches = true; media.dispatchEvent(new Event("change")); });
  expect(document.documentElement.dataset).toMatchObject({ uiTheme: "dark", paperTheme: "soft" });
  act(() => { localStorage.setItem("same-page:appearance:user:appearance-user", JSON.stringify({ ...defaultAppearance, darkPaper: "original" })); window.dispatchEvent(new StorageEvent("storage", { key: "same-page:appearance:user:appearance-user" })); });
  expect(document.documentElement.dataset.paperTheme).toBe("original");
});
it("isolates users and experience, and clears private appearance on logout", () => {
  saveAppearance("user:appearance-user", { ...defaultAppearance, interfaceTheme: "dark" });
  saveAppearance("experience:appearance-user", { ...defaultAppearance, lightPaper: "soft" });
  expect(readAppearance("user:someone-else")).toEqual(defaultAppearance);
  const view = render(settings("/choirs/one/scores/two?experience=1"));
  expect(document.documentElement.dataset).toMatchObject({ uiTheme: "light", paperTheme: "soft" });
  view.unmount(); clearUserAppearance("appearance-user");
  expect(readAppearance("user:appearance-user")).toEqual(defaultAppearance);
  expect(readAppearance("experience:appearance-user")).toEqual(defaultAppearance);
});
it("keeps changes usable and explains when storage cannot persist", () => {
  const view = render(settings());
  const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
  fireEvent.change(screen.getByLabelText("界面主题"), { target: { value: "dark" } });
  expect(document.documentElement.dataset.uiTheme).toBe("dark");
  expect(screen.getByRole("status")).toHaveTextContent("无法保存");
  spy.mockRestore(); view.unmount(); clearUserAppearance("appearance-user");
});
