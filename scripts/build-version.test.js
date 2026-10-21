import { expect, it } from "vitest";
import { formatBuildVersion } from "./build-version.mjs";

it("formats release time in Shanghai across UTC day/year boundaries and at midnight", () => {
  expect(formatBuildVersion(new Date("2026-10-20T10:30:59Z"))).toBe("v26.10.20.1830");
  expect(formatBuildVersion(new Date("2026-12-31T16:00:00Z"))).toBe("v27.01.01.0000");
});
