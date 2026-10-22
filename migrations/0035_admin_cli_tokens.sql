-- Independent, bounded CLI credentials. Existing browser sessions are unchanged.
CREATE TABLE admin_cli_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  can_upload INTEGER NOT NULL DEFAULT 0 CHECK(can_upload IN (0,1)),
  drive_ids TEXT NOT NULL CHECK(json_valid(drive_ids) AND json_type(drive_ids)='array'),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  last_used_at INTEGER
);
CREATE INDEX admin_cli_tokens_user ON admin_cli_tokens(user_id, created_at DESC);
