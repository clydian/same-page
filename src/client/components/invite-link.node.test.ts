import { describe, expect, it } from "vitest";
import { createInviteLink, readInviteLink, readScannedInvite } from "./invite-link";

describe("invitation links", () => {
  it("keeps the credential in the fragment and round trips it", () => {
    const url = new URL(createInviteLink("https://example.invalid", "ABCDEFGH"));
    expect(url.pathname + url.search).toBe("/?join=1");
    expect(readInviteLink(url.hash)).toEqual({ code: "ABCDEFGH" });
  });
  it("distinguishes absent, grouped and malformed codes without truncating", () => {
    expect(readInviteLink("")).toBeNull();
    expect(readInviteLink("#invite=abcd-efgh")).toEqual({ code: "ABCDEFGH" });
    for (const hash of ["#invite=", "#invite=ABCDEFGHJ", "#invite=ABCD!EFGH", "#invite=ABCDEFGH&invite=HGFEDCBA"]) {
      expect(readInviteLink(hash)).toEqual({ code: null });
    }
  });
  it("accepts existing invitation cards but refuses foreign origins, credentials, paths and duplicate credentials", () => {
    const origin = "https://example.invalid";
    expect(readScannedInvite(createInviteLink(origin, "ABCDEFGH"), origin)).toBe("ABCDEFGH");
    for (const value of ["ABCDEFGH", "javascript:alert(1)", "https://other.test/?join=1#invite=ABCDEFGH", "https://user@example.invalid/?join=1#invite=ABCDEFGH", `${origin}/private?join=1#invite=ABCDEFGH`, `${origin}/?join=1&join=1#invite=ABCDEFGH`, `${origin}/?join=1#invite=ABCDEFGH&invite=HGFEDCBA`]) expect(readScannedInvite(value, origin)).toBeNull();
  });
});
