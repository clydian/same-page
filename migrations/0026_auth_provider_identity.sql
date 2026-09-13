-- Better Auth 1.7.3 identifies accounts by (provider_id, account_id).
-- Fail before rebuilding if that identity is ambiguous; never merge users.
CREATE UNIQUE INDEX account_provider_accountId_preflight
  ON account(provider_id, account_id);

-- No tables reference account. Preserve its IDs, credentials and user FK.
-- Keep issuer nullable so the old Worker can still write during deployment.
CREATE TABLE account_compat (
  id TEXT PRIMARY KEY NOT NULL,
  issuer TEXT,
  account_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  access_token TEXT,
  refresh_token TEXT,
  id_token TEXT,
  access_token_expires_at INTEGER,
  refresh_token_expires_at INTEGER,
  scope TEXT,
  password TEXT,
  created_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsecond') * 1000 AS INTEGER)),
  updated_at INTEGER NOT NULL
);
INSERT INTO account_compat SELECT
  id, issuer, account_id, provider_id, user_id, access_token, refresh_token,
  id_token, access_token_expires_at, refresh_token_expires_at, scope,
  password, created_at, updated_at FROM account;
DROP TABLE account;
ALTER TABLE account_compat RENAME TO account;
CREATE UNIQUE INDEX account_provider_accountId_uidx ON account(provider_id, account_id);
CREATE INDEX account_userId_idx ON account(user_id);
