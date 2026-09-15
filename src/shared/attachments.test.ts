import { expect, it } from "vitest";
import { attachmentUrlSchema, safeAttachmentUrl } from "./attachments";

it("rejects blank, malformed and executable links without throwing during ordinary file form validation", () => {
  for (const value of ["", "https://", "javascript:alert(1)", "data:text/html,test", "https://user:password@example.org", "#section"]) {
    expect(attachmentUrlSchema.safeParse(value).success).toBe(false);
    expect(safeAttachmentUrl(value)).toBe("");
  }
  expect(safeAttachmentUrl("https://example.org/reference?q=合唱")).toBe("https://example.org/reference?q=合唱");
});
