import { describe, expect, it } from "vitest";
import { createDriveHref, loginHref, loginReturn } from "./login-return";

describe("login destinations", () => {
  it("round-trips a score page and annotation intent", () => {
    const target = "/choirs/choir/scores/score";
    const { search } = new URL(loginHref(target, { page: 2, action: "annotate" }), "https://example.test");
    expect(loginReturn(search)).toMatchObject({ target, reader: { page: 2, action: "annotate" } });
  });

  it("allows the exact create route and drops reader intent on non-score routes", () => {
    const { search } = new URL(loginHref(createDriveHref, { page: 2, action: "annotate" }), "https://example.test");
    expect(loginReturn(search)).toEqual({ target: createDriveHref });
  });

  it.each(["//example.test", "https://example.test", "/choirs/drive/../admin", "/drives?create=1&next=//example.test"])(
    "rejects unsupported destinations: %s", target => {
      expect(loginReturn(new URLSearchParams({ returnTo: target }).toString())).toBeNull();
    },
  );
});
