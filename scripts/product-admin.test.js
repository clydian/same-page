import { expect, it } from "vitest";
import { productAdminQuery } from "./product-admin.mjs";

it("grants and revokes one product role and rejects legacy partial grants", () => {
  expect(productAdminQuery(["grant", "--local", "user-1"]).sql).toBe("INSERT INTO product_administrators(user_id) VALUES('user-1') ON CONFLICT DO NOTHING");
  expect(productAdminQuery(["revoke", "--remote", "user-1"]).sql).toBe("DELETE FROM product_administrators WHERE user_id='user-1'");
  for (const args of [["grant", "user-1"], ["grant", "--remote", "x';DROP TABLE user"], ["grant", "--local", "mail@example.test"], ["grant", "--local", "user", "view"], ["grant-release", "--local", "user"], ["enable-drive", "--local", "drive"]]) expect(() => productAdminQuery(args)).toThrow();
});

it("refuses the retired feedback-only command", async () => {
  await expect(import("./diagnostic-operators.mjs")).rejects.toThrow("all product admin functions");
});
