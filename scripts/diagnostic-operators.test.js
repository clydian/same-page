import { expect, it } from "vitest";
import { diagnosticOperatorQuery } from "./diagnostic-operators.mjs";

it("configures only explicit feedback authority, with management as the default", () => {
  expect(diagnosticOperatorQuery(["grant", "--local", "user-1"]).sql).toContain("VALUES('user-1',0)");
  expect(diagnosticOperatorQuery(["grant", "--remote", "user-1", "delete"]).sql).toContain("VALUES('user-1',1)");
  expect(diagnosticOperatorQuery(["revoke", "--remote", "user-1"]).sql).toBe("DELETE FROM diagnostic_operators WHERE user_id='user-1'");
  for (const args of [["grant", "user-1"], ["grant", "--remote", "x';DROP TABLE user"], ["grant", "--local", "mail@example.test"], ["revoke", "--remote", "user", "delete"]]) expect(() => diagnosticOperatorQuery(args)).toThrow();
});
