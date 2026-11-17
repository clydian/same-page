import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Product-wide access only. This never changes drive memberships or permissions.
export function productAdminQuery(argv) {
  const [action, mode, id, ...extra] = argv;
  if (!["grant", "revoke"].includes(action) || !["--local", "--remote"].includes(mode)
    || !/^[a-zA-Z0-9_-]{1,128}$/.test(id ?? "") || extra.length) {
    throw new Error("Usage: admin:configure -- grant|revoke --local|--remote USER_ID (all product admin functions)");
  }
  return { mode, sql: action === "grant"
    ? `INSERT INTO product_administrators(user_id) VALUES('${id}') ON CONFLICT DO NOTHING`
    : `DELETE FROM product_administrators WHERE user_id='${id}'` };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { mode, sql } = productAdminQuery(process.argv.slice(2));
  const result = spawnSync("npx", ["wrangler", "d1", "execute", "same-page-production", mode, "--command", sql], { stdio: "inherit" });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
