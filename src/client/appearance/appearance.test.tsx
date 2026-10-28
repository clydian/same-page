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
  fireEvent.click(screen.getByRole("radio", { name: "深色界面下的谱面：反色" }));
  expect(document.documentElement.dataset.paperTheme).toBe("original");
  fireEvent.click(screen.getByRole("radio", { name: "深色" }));
  expect(document.documentElement.dataset).toMatchObject({ uiTheme: "dark", paperTheme: "inverted", invertAnnotations: "false" });
  fireEvent.click(screen.getByRole("radio", { name: "跟随反色" }));
  view.unmount(); render(settings());
  expect(screen.getByRole("radio", { name: "深色" })).toBeChecked();
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
  fireEvent.click(screen.getByRole("radio", { name: "深色" }));
  expect(document.documentElement.dataset.uiTheme).toBe("dark");
  expect(screen.getByRole("status")).toHaveTextContent("无法保存");
  spy.mockRestore(); view.unmount(); clearUserAppearance("appearance-user");
});

it("guest settings and guest experience share choices while signed-in experience stays separate", () => {
  identity.localUserId = "";
  const view = render(settings());
  fireEvent.click(screen.getByRole("radio", { name: "深色" }));
  view.unmount();
  const preview = render(settings("/user?experience=1"));
  expect(screen.getByRole("radio", { name: "深色" })).toBeChecked();
  preview.unmount();
  identity.localUserId = "appearance-user";
  render(settings("/user?experience=1"));
  expect(screen.getByRole("radio", { name: "跟随系统" })).toBeChecked();
  fireEvent.click(screen.getByRole("radio", { name: "深色" }));
  expect(readAppearance("experience:appearance-user").interfaceTheme).toBe("dark");
  expect(readAppearance("user:appearance-user").interfaceTheme).toBe("system");
});
