import { spawnSync } from "node:child_process";
// Explicit operator-only CLI. Never accepts an email or alters memberships.
const [action, mode, id, ...args] = process.argv.slice(2);
const validId = (v) =>
  typeof v === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(v);
if (!["--local", "--remote"].includes(mode) || !validId(id))
  throw new Error(
    "Usage: npm run admin:configure -- grant|revoke|enable-drive|disable-drive --local|--remote ID [view|review|publish]",
  );
const quoted = `'${id}'`;
let sql;
if (action === "grant") {
  const level = args[0] ?? "view";
  if (args.length > 1 || !["view", "review", "publish"].includes(level))
    throw new Error("Choose view, review or publish");
  sql = `INSERT INTO product_operators(user_id,view_scores,review_xml,publish_xml) VALUES(${quoted},1,${level === "view" ? 0 : 1},${level === "publish" ? 1 : 0}) ON CONFLICT(user_id) DO UPDATE SET view_scores=1,review_xml=excluded.review_xml,publish_xml=excluded.publish_xml;`;
} else {
  if (args.length) throw new Error("Unexpected argument");
  sql = {
    "grant-release": `INSERT INTO release_operators(user_id) VALUES(${quoted}) ON CONFLICT DO NOTHING;`,
    "revoke-release": `DELETE FROM release_operators WHERE user_id=${quoted};`,
    revoke: `DELETE FROM product_operators WHERE user_id=${quoted};`,
    "enable-drive": `INSERT INTO product_admin_drives(choir_id) VALUES(${quoted}) ON CONFLICT DO NOTHING;`,
    "disable-drive": `DELETE FROM product_admin_drives WHERE choir_id=${quoted};`,
  }[action];
  if (!sql) throw new Error("Unknown action");
  if (["enable-drive", "disable-drive"].includes(action)) {
    console.warn("Legacy pilot record only: this command does not change the product operator workbench scope. Use grant/revoke to manage operator access.");
  }
}
const r = spawnSync(
  "npx",
  ["wrangler", "d1", "execute", "same-page-production", mode, "--command", sql],
  { stdio: "inherit" },
);
if (r.error) throw r.error;
process.exitCode = r.status ?? 1;
