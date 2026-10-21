import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export function diagnosticOperatorQuery(argv) {
  const [action, mode, id, level, ...extra] = argv;
  if (!["--local", "--remote"].includes(mode) || !/^[a-zA-Z0-9_-]{1,128}$/.test(id ?? "") || extra.length)
    throw new Error("Usage: diagnostics:operators -- grant|revoke --local|--remote USER_ID [manage|delete]");
  if (action === "revoke" && level === undefined) return { mode, sql: `DELETE FROM diagnostic_operators WHERE user_id='${id}'` };
  if (action !== "grant" || ![undefined, "manage", "delete"].includes(level)) throw new Error("Choose grant [manage|delete] or revoke");
  return { mode, sql: `INSERT INTO diagnostic_operators(user_id,can_delete) VALUES('${id}',${level === "delete" ? 1 : 0}) ON CONFLICT(user_id) DO UPDATE SET can_delete=excluded.can_delete` };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { mode, sql } = diagnosticOperatorQuery(process.argv.slice(2));
  const result = spawnSync("npx", ["wrangler", "d1", "execute", "same-page-production", mode, "--command", sql], { stdio: "inherit" });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
