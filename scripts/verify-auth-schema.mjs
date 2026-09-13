import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { executeD1 } from "./backfill-score-file-names.mjs";

export function verifyAuthSchema(mode, targetArgs) {
  assert(mode === "before" || mode === "after", "Expected before or after");
  const query = (command) => executeD1({ command, targetArgs }).map((r) => r.results);
  // Aggregate only: never print identity keys, credentials or user records.
  const [duplicates] = query(`SELECT COUNT(*) AS count FROM (
    SELECT 1 FROM account GROUP BY provider_id, account_id HAVING COUNT(*) > 1)`);
  assert.equal(duplicates[0].count, 0, "Ambiguous auth provider identities; resolve before migration");
  if (mode === "after") {
    const [columns, indexes, keyColumns, violations] = query(`PRAGMA table_info(account);
      PRAGMA index_list(account); PRAGMA index_info(account_provider_accountId_uidx);
      SELECT COUNT(*) AS count FROM pragma_foreign_key_check`);
    assert.equal(columns.find((c) => c.name === "issuer")?.notnull, 0, "issuer must remain nullable during transition");
    assert(indexes.some((i) => i.name === "account_provider_accountId_uidx" && i.unique === 1));
    assert(!indexes.some((i) => i.name === "account_issuer_accountId_uidx"));
    assert.deepEqual(keyColumns.map((c) => c.name), ["provider_id", "account_id"]);
    assert.equal(violations[0].count, 0, "Foreign-key violations after migration");
  }
  console.log(`Verified auth schema (${mode}).`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, target] = process.argv.slice(2);
  assert(target === "--local" || target === "--remote", "Explicit --local or --remote required");
  verifyAuthSchema(mode, [target]);
}
